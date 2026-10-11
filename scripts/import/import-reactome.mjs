#!/usr/bin/env node
// MetaboMap importer: Reactome (+ ChEBI via EBI OLS) -> static JSON consumed by the web app.
//
// Usage:
//   node scripts/import/import-reactome.mjs [rootPathwayStId ...] [--no-chebi]
// Default root: R-HSA-1430728 (Metabolism, Homo sapiens).
//
// Output:
//   public/data/dataset.json        graph data (validated by the app with Zod)
//   public/data/details/<n>.json    lazily loaded texts: summaries, literature, ChEBI definitions/SMILES
//
// Licenses: Reactome — CC BY 4.0; ChEBI — CC BY 4.0. KEGG/MetaCyc are NOT downloaded (license
// restrictions); only KEGG identifiers present in Reactome cross-references are kept as links.

import { mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chunk, fetchJson, mapAll, stats } from "./lib/http.mjs";
import { shardOf } from "./lib/shard.mjs";
import { CURRENCY_CHEBI } from "./curation/currency.mjs";
import { RU_COMPARTMENTS, RU_ENZYMES_BY_EC, RU_METABOLITES, RU_PATHWAYS } from "./curation/ru-names.mjs";

const CS = "https://reactome.org/ContentService";
const OLS = "https://www.ebi.ac.uk/ols4/api/ontologies/chebi/terms";
const OUT_DIR = fileURLToPath(new URL("../../public/data/", import.meta.url));
const DETAIL_SHARDS = 64;

const args = process.argv.slice(2);
const withChebi = !args.includes("--no-chebi");
const ROOTS = args.filter((a) => !a.startsWith("--"));
if (ROOTS.length === 0) ROOTS.push("R-HSA-1430728");

const REACTION_CLASSES = new Set(["Reaction", "BlackBoxEvent", "Polymerisation", "Depolymerisation"]);

// ---------------------------------------------------------------- helpers
const refId = (x) => (typeof x === "number" ? x : x?.dbId);
const asArray = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const stripCompartment = (s) => s.replace(/\s*\[[^\]]+\]\s*$/, "").trim();
const goId = (c) => (c?.accession ? `GO:${c.accession}` : undefined);
const reactomeRef = (stId, label) => ({ db: "reactome", id: stId, url: `https://reactome.org/content/detail/${stId}`, label });

/** Batch-fetch full objects by id (dbId or stId), 20 per request. */
async function queryIds(ids, label) {
  const unique = [...new Set(ids.map(String))];
  const out = new Map();
  await mapAll(
    chunk(unique, 20),
    async (batch) => {
      const res = await fetchJson(`${CS}/data/query/ids`, {
        method: "POST",
        body: batch.join(","),
        headers: { "Content-Type": "text/plain" },
      });
      for (const obj of asArray(res)) if (obj && typeof obj === "object") out.set(obj.dbId, obj);
    },
    label,
  );
  return out;
}

/** Choose a readable name: skip abbreviations and charge-state suffixes when possible. */
function pickNames(names) {
  const list = names.filter(Boolean);
  const readable = (n) => n.length > 5 && /[a-z]{3}/.test(n);
  const charged = (n) => /\(\d*[+-]\)$/.test(n);
  const name =
    list.find((n) => readable(n) && !charged(n)) ?? list.find(readable) ?? list[0] ?? "unnamed";
  const first = list[0];
  const abbreviation = first && first !== name && first.length <= 14 ? first : undefined;
  return { name, abbreviation };
}

function kindOf(pe) {
  switch (pe.schemaClass) {
    case "SimpleEntity":
    case "ChemicalDrug":
      return "small-molecule";
    case "DefinedSet":
    case "CandidateSet":
    case "OpenSet":
      return "set";
    case "Complex":
      return "complex";
    case "Polymer":
      return "polymer";
    case "EntityWithAccessionedSequence":
    case "GenomeEncodedEntity":
      return "macromolecule";
    default:
      return "other";
  }
}

function literature(obj) {
  return asArray(obj.literatureReference)
    .filter((l) => l && typeof l === "object" && l.title)
    .slice(0, 12)
    .map((l) => ({
      title: l.title,
      journal: l.journal ?? undefined,
      year: typeof l.year === "number" ? l.year : undefined,
      pubmedId: l.pubMedIdentifier ? String(l.pubMedIdentifier) : undefined,
      url: l.url ?? undefined,
    }));
}

function summary(obj) {
  const texts = asArray(obj.summation)
    .map((s) => (typeof s === "object" ? s.text : undefined))
    .filter(Boolean);
  return texts.length ? texts.join("\n\n") : undefined;
}

// ---------------------------------------------------------------- main
async function main() {
  const t0 = Date.now();
  const version = String(await fetchJson(`${CS}/data/database/version`, { useCache: false, headers: { Accept: "text/plain" } }));
  console.log(`Reactome release ${version}; roots: ${ROOTS.join(", ")}`);

  // 1. Events under the roots: breadth-first over `hasEvent` (repeated objects in Reactome JSON
  //    are serialised as bare dbIds, so the hierarchy is walked explicitly).
  const eventsById = new Map();
  let pending = [...ROOTS];
  for (let depth = 0; pending.length && depth < 20; depth++) {
    const fetched = await queryIds(pending, `events (level ${depth})`);
    const next = new Set();
    for (const [dbId, ev] of fetched) {
      eventsById.set(dbId, ev);
      for (const child of asArray(ev.hasEvent)) {
        const id = refId(child);
        if (id && !eventsById.has(id) && !fetched.has(id)) next.add(id);
      }
    }
    pending = [...next];
  }
  console.log(`Events: ${eventsById.size}`);
  const events = [...eventsById.values()].filter((e) => !e.isInDisease && e.speciesName === "Homo sapiens");
  const pathwaysRaw = events.filter((e) => e.schemaClass === "Pathway" || e.schemaClass === "TopLevelPathway");
  const reactionsRaw = events.filter((e) => REACTION_CLASSES.has(e.schemaClass));
  const keptReactionDbIds = new Set(reactionsRaw.map((r) => r.dbId));
  const keptPathwayDbIds = new Set(pathwaysRaw.map((p) => p.dbId));
  console.log(`Pathways: ${pathwaysRaw.length}, reaction-like events: ${reactionsRaw.length}`);

  // 2. Catalyst activities and regulations
  const caIds = reactionsRaw.flatMap((r) => asArray(r.catalystActivity).map(refId));
  const regIds = reactionsRaw.flatMap((r) => asArray(r.regulatedBy).map(refId));
  const catalystActivities = await queryIds(caIds, "catalyst activities");
  const regulations = await queryIds(regIds, "regulations");

  // 3. Physical entities: participants, catalysts, regulators
  const peIds = new Set();
  for (const r of reactionsRaw) for (const x of [...asArray(r.input), ...asArray(r.output)]) peIds.add(refId(x));
  for (const ca of catalystActivities.values()) peIds.add(refId(ca.physicalEntity));
  for (const reg of regulations.values()) if (reg.regulator) peIds.add(refId(reg.regulator));
  peIds.delete(undefined);
  const pes = await queryIds([...peIds], "physical entities");

  // 3b. Composition of catalysts (genes, bound small molecules): walk complexes/sets up to depth 5
  const catalystPeIds = new Set([...catalystActivities.values()].map((ca) => refId(ca.physicalEntity)));
  const childRefs = (pe) => [
    ...asArray(pe.hasComponent),
    ...asArray(pe.hasMember),
    ...asArray(pe.hasCandidate),
    ...asArray(pe.repeatedUnit),
  ];
  let frontier = [...catalystPeIds].map((id) => pes.get(id)).filter(Boolean);
  for (let depth = 0; depth < 5 && frontier.length; depth++) {
    const need = new Set();
    for (const pe of frontier)
      for (const c of childRefs(pe)) {
        const id = refId(c);
        if (id && !pes.has(id)) need.add(id);
      }
    if (need.size === 0) break;
    const fetched = await queryIds([...need], `catalyst components (depth ${depth + 1})`);
    for (const [id, obj] of fetched) pes.set(id, obj);
    frontier = [...fetched.values()];
  }

  /** genes and small-molecule cofactors inside a catalyst entity */
  const compositionCache = new Map();
  function composition(peId, seen = new Set()) {
    if (compositionCache.has(peId)) return compositionCache.get(peId);
    const result = { genes: new Set(), cofactors: new Set() };
    const pe = pes.get(peId);
    if (!pe || seen.has(peId)) return result;
    seen.add(peId);
    if (pe.schemaClass === "EntityWithAccessionedSequence") {
      const g = asArray(pe.name)[0];
      if (g) result.genes.add(g);
    } else if (pe.schemaClass === "SimpleEntity") {
      result.cofactors.add(peId);
    }
    for (const c of childRefs(pe)) {
      const id = refId(c);
      // embedded shallow EWAS objects carry the gene symbol as their first name
      if (typeof c === "object" && c.schemaClass === "EntityWithAccessionedSequence" && !pes.has(id)) {
        const g = asArray(c.name)[0];
        if (g) result.genes.add(g);
        continue;
      }
      const sub = composition(id, seen);
      sub.genes.forEach((g) => result.genes.add(g));
      sub.cofactors.forEach((x) => result.cofactors.add(x));
    }
    compositionCache.set(peId, result);
    return result;
  }

  // 4. Compartments + metabolites
  const compartments = new Map();
  const addCompartment = (c) => {
    const id = goId(c);
    if (!id) return undefined;
    if (!compartments.has(id)) compartments.set(id, { id, name: c.name ?? c.displayName, nameRu: RU_COMPARTMENTS.get(id) });
    return id;
  };

  const metabolites = new Map(); // key: PE dbId
  const metabolitesByStId = new Map();
  function metaboliteFor(peId) {
    if (metabolites.has(peId)) return metabolites.get(peId);
    const pe = pes.get(peId);
    if (!pe) return undefined;
    const compartmentId = addCompartment(asArray(pe.compartment)[0]) ?? addCompartment({ accession: "0005575", name: "cellular_component" });
    const ref = pe.referenceEntity && typeof pe.referenceEntity === "object" ? pe.referenceEntity : undefined;
    const chebiId = ref?.databaseName === "ChEBI" ? `CHEBI:${ref.identifier}` : undefined;
    const names = asArray(pe.name).length ? asArray(pe.name) : [stripCompartment(pe.displayName)];
    const { name, abbreviation } = pickNames(names);
    const keggId = asArray(pe.crossReference).find((x) => x?.databaseName === "COMPOUND")?.identifier;
    const currencyAbbr = chebiId ? CURRENCY_CHEBI.get(chebiId) : undefined;
    const m = {
      id: pe.stId,
      name,
      nameRu: chebiId ? RU_METABOLITES.get(chebiId) : undefined,
      abbreviation: currencyAbbr ?? abbreviation,
      synonyms: [...new Set(names.filter((n) => n !== name))].slice(0, 20),
      kind: kindOf(pe),
      compartmentId,
      chebiId,
      formula: ref?.formula ?? undefined,
      keggId,
      currency: !!currencyAbbr,
      sources: [
        reactomeRef(pe.stId, `${pe.stId} (${stripCompartment(pe.displayName)})`),
        ...(chebiId ? [{ db: "chebi", id: chebiId, url: `https://www.ebi.ac.uk/chebi/searchId.do?chebiId=${chebiId}` }] : []),
        ...(keggId ? [{ db: "kegg", id: keggId, url: `https://www.kegg.jp/entry/${keggId}` }] : []),
      ],
    };
    metabolites.set(peId, m);
    metabolitesByStId.set(m.id, m);
    return m;
  }

  // 5. Enzymes (one per catalyst physical entity)
  const enzymes = new Map(); // key: PE dbId
  function enzymeFor(ca, reactionStId, reactionCompartments) {
    const peId = refId(ca.physicalEntity);
    const pe = pes.get(peId);
    if (!pe) return undefined;
    let e = enzymes.get(peId);
    const ec = ca.activity?.ecNumber ? String(ca.activity.ecNumber).split(/[,;\s]+/).filter(Boolean) : [];
    if (!e) {
      const comp = composition(peId);
      const cofactorIds = [...comp.cofactors].map((id) => metaboliteFor(id)?.id).filter(Boolean);
      const names = asArray(pe.name);
      e = {
        id: pe.stId,
        name: stripCompartment(pe.displayName),
        nameRu: undefined,
        synonyms: [...new Set(names.filter((n) => n !== stripCompartment(pe.displayName)))].slice(0, 10),
        genes: [...comp.genes].sort(),
        ecNumbers: [],
        activity: ca.activity?.name ?? undefined,
        activityRu: undefined,
        cofactorIds: [...new Set(cofactorIds)],
        reactionIds: [],
        compartmentIds: [],
        sources: [reactomeRef(pe.stId)],
      };
      enzymes.set(peId, e);
    }
    for (const x of ec) if (!e.ecNumbers.includes(x)) e.ecNumbers.push(x);
    if (!e.reactionIds.includes(reactionStId)) e.reactionIds.push(reactionStId);
    const peComp = goId(asArray(pe.compartment)[0]);
    for (const c of peComp ? [peComp] : reactionCompartments) if (!e.compartmentIds.includes(c)) e.compartmentIds.push(c);
    if (!e.activityRu) e.activityRu = e.ecNumbers.map((x) => RU_ENZYMES_BY_EC.get(x)).find(Boolean);
    return e;
  }

  // 6. Reactions
  const stIdByDbId = new Map(events.map((e) => [e.dbId, e.stId]));
  const pathwaysOfReaction = new Map();
  for (const p of pathwaysRaw)
    for (const ev of asArray(p.hasEvent)) {
      const id = refId(ev);
      if (keptReactionDbIds.has(id)) {
        const list = pathwaysOfReaction.get(id) ?? [];
        list.push(p.stId);
        pathwaysOfReaction.set(id, list);
      }
    }

  const details = {}; // id -> RecordDetails
  const reactions = [];
  let skippedEmpty = 0;
  for (const r of reactionsRaw) {
    const side = (list) => {
      const counts = new Map();
      for (const x of asArray(list)) {
        const id = refId(x);
        if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      return [...counts.entries()]
        .map(([peId, n]) => {
          const m = metaboliteFor(peId);
          return m ? { metaboliteId: m.id, stoichiometry: n } : undefined;
        })
        .filter(Boolean);
    };
    const inputs = side(r.input);
    const outputs = side(r.output);
    if (inputs.length === 0 && outputs.length === 0) {
      skippedEmpty++;
      continue;
    }
    const compartmentIds = [...new Set(asArray(r.compartment).map(addCompartment).filter(Boolean))];
    const enz = asArray(r.catalystActivity)
      .map((x) => catalystActivities.get(refId(x)))
      .filter(Boolean)
      .map((ca) => enzymeFor(ca, r.stId, compartmentIds))
      .filter(Boolean);
    const ecNumbers = [...new Set(enz.flatMap((e) => e.ecNumbers))];

    const regulation = asArray(r.regulatedBy)
      .map((x) => regulations.get(refId(x)))
      .filter((g) => g && g.regulator)
      .map((g) => {
        const regPeId = refId(g.regulator);
        const regPe = pes.get(regPeId);
        const kind = regPe ? kindOf(regPe) : "other";
        const metab = kind === "small-molecule" || kind === "set" ? metaboliteFor(regPeId) : undefined;
        return {
          type: g.schemaClass === "NegativeRegulation" ? "negative" : g.schemaClass === "Requirement" ? "requirement" : "positive",
          regulatorId: metab?.id,
          regulatorName: stripCompartment(regPe?.displayName ?? g.regulator.displayName ?? "?"),
          sources: [reactomeRef(g.stId ?? r.stId)],
        };
      });

    // transport: the same chemical appears on both sides in different compartments
    const byChebi = (parts) => {
      const map = new Map();
      for (const p of parts) {
        const m = metabolitesByStId.get(p.metaboliteId);
        if (m?.chebiId && !m.currency) map.set(m.chebiId, m.compartmentId);
      }
      return map;
    };
    const inMap = byChebi(inputs);
    const outMap = byChebi(outputs);
    const isTransport = [...inMap].some(([chebi, comp]) => outMap.has(chebi) && outMap.get(chebi) !== comp);

    const rheaIds = [
      ...new Set(
        asArray(r.crossReference)
          .filter((x) => x?.databaseName === "RHEA")
          .map((x) => String(x.identifier)),
      ),
    ];
    const category =
      r.schemaClass === "BlackBoxEvent"
        ? "black-box"
        : r.schemaClass === "Polymerisation"
          ? "polymerisation"
          : r.schemaClass === "Depolymerisation"
            ? "depolymerisation"
            : ["transition", "binding", "dissociation", "omitted", "uncertain"].includes(r.category)
              ? r.category
              : "transition";
    const reverseId = refId(r.reverseReaction);

    reactions.push({
      id: r.stId,
      name: r.displayName,
      inputs,
      outputs,
      // Reactome encodes each direction as its own event; a single record is directional.
      reversible: false,
      reverseReactionId: reverseId ? stIdByDbId.get(reverseId) : undefined,
      reverseSource: reverseId && stIdByDbId.get(reverseId) ? "reactome" : undefined,
      enzymeIds: [...new Set(enz.map((e) => e.id))],
      ecNumbers,
      compartmentIds,
      pathwayIds: pathwaysOfReaction.get(r.dbId) ?? [],
      regulation,
      category,
      isTransport,
      rheaIds,
      sources: [
        reactomeRef(r.stId, r.isInferred ? `${r.stId} (выведено по ортологии)` : r.stId),
        ...rheaIds.map((x) => ({ db: "rhea", id: `RHEA:${x}`, url: `https://www.rhea-db.org/rhea/${x}` })),
      ],
    });
    const text = summary(r);
    const lit = literature(r);
    if (text || lit.length)
      details[r.stId] = { id: r.stId, summary: text, summarySource: text ? reactomeRef(r.stId, "Reactome") : undefined, literature: lit };
  }

  // 6a. Reactome reverse links are made symmetric (A->B implies B->A) when B has none.
  const reactionById = new Map(reactions.map((r) => [r.id, r]));
  for (const r of reactions) {
    if (r.reverseSource !== "reactome") continue;
    const other = reactionById.get(r.reverseReactionId);
    if (other && !other.reverseReactionId) {
      other.reverseReactionId = r.id;
      other.reverseSource = "reactome";
    }
  }

  // 6b. Reverse pairs: Reactome encodes each direction as its own event. Two reactions whose main
  //     (non-currency) substrates and products are swapped, in the same compartments, are linked.
  const mainKey = (parts) =>
    parts
      .map((p) => metabolitesByStId.get(p.metaboliteId))
      .filter((m) => m && !m.currency)
      .map((m) => m.id)
      .sort()
      .join("+");
  const bySignature = new Map();
  for (const r of reactions) {
    const sig = `${mainKey(r.inputs)}>${mainKey(r.outputs)}`;
    if (!bySignature.has(sig)) bySignature.set(sig, []);
    bySignature.get(sig).push(r);
  }
  // Only unambiguous pairs are linked: exactly one candidate in each direction, both still free.
  // Isoenzyme duplicates make a pairing ambiguous; those are left unlinked rather than guessed.
  let reversePairs = 0;
  let ambiguous = 0;
  for (const r of reactions) {
    if (r.reverseReactionId) continue;
    const ins = mainKey(r.inputs);
    const outs = mainKey(r.outputs);
    if (!ins || !outs || ins === outs) continue;
    const forward = bySignature.get(`${ins}>${outs}`) ?? [];
    const backward = (bySignature.get(`${outs}>${ins}`) ?? []).filter((x) => x.id !== r.id);
    if (backward.length === 0) continue;
    if (forward.length !== 1 || backward.length !== 1 || backward[0].reverseReactionId) {
      ambiguous++;
      continue;
    }
    const match = backward[0];
    r.reverseReactionId = match.id;
    r.reverseSource = "inferred";
    match.reverseReactionId = r.id;
    match.reverseSource = "inferred";
    reversePairs++;
  }
  console.log(`Ambiguous reverse candidates left unlinked: ${ambiguous}`);
  console.log(`Reverse reaction pairs linked: ${reversePairs}`);

  // 7. Pathways
  const reactionStIds = new Set(reactions.map((r) => r.id));
  const pathways = pathwaysRaw.map((p) => {
    const evs = asArray(p.hasEvent).map(refId);
    const text = summary(p);
    const lit = literature(p);
    if (text || lit.length)
      details[p.stId] = { id: p.stId, summary: text, summarySource: text ? reactomeRef(p.stId, "Reactome") : undefined, literature: lit };
    return {
      id: p.stId,
      name: p.displayName,
      nameRu: RU_PATHWAYS.get(p.stId),
      reactionIds: evs.filter((id) => keptReactionDbIds.has(id)).map((id) => stIdByDbId.get(id)).filter((id) => reactionStIds.has(id)),
      subpathwayIds: evs.filter((id) => keptPathwayDbIds.has(id)).map((id) => stIdByDbId.get(id)),
      parentIds: [],
      sources: [reactomeRef(p.stId)],
    };
  });
  const pById = new Map(pathways.map((p) => [p.id, p]));
  for (const p of pathways) for (const s of p.subpathwayIds) pById.get(s)?.parentIds.push(p.id);

  // 8. ChEBI details (definition, SMILES, InChIKey, synonyms) via EBI OLS
  const metList = [...metabolites.values()];
  if (withChebi) {
    const chebiIds = [...new Set(metList.map((m) => m.chebiId).filter(Boolean))];
    const chebi = new Map();
    await mapAll(
      chebiIds,
      async (cid) => {
        try {
          const res = await fetchJson(`${OLS}?obo_id=${encodeURIComponent(cid)}`);
          const t = res?._embedded?.terms?.[0];
          if (t) chebi.set(cid, t);
        } catch (err) {
          console.warn(`\n  ChEBI ${cid}: ${err.message}`);
        }
      },
      "ChEBI terms",
    );
    for (const [cid, t] of chebi) {
      const a = t.annotation ?? {};
      const definition = asArray(t.description)[0];
      details[cid] = {
        id: cid,
        definition: definition ?? undefined,
        smiles: asArray(a.smiles_string)[0] ?? undefined,
        inchiKey: asArray(a.inchi_key_string)[0] ?? undefined,
        charge: Number.isFinite(Number(asArray(a.charge)[0])) && asArray(a.charge).length ? Number(asArray(a.charge)[0]) : undefined,
        mass: Number.isFinite(Number(asArray(a.mass)[0])) && asArray(a.mass).length ? Number(asArray(a.mass)[0]) : undefined,
        literature: [],
      };
    }
    for (const m of metList) {
      const t = m.chebiId ? chebi.get(m.chebiId) : undefined;
      if (!t) continue;
      const syn = [t.label, ...asArray(t.synonyms)].filter((s) => s && s !== m.name);
      m.synonyms = [...new Set([...m.synonyms, ...syn])].slice(0, 30);
    }
  }

  // 9. Write output
  const sortById = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const dataset = {
    meta: {
      title: "Метаболизм человека — Reactome",
      generatedAt: new Date().toISOString(),
      isMock: false,
      sources: [
        {
          name: "Reactome",
          version,
          license: "CC BY 4.0",
          url: "https://reactome.org",
          usage: "Реакции, стехиометрия, компартменты, катализаторы, регуляция, иерархия путей, описания и литература",
        },
        ...(withChebi
          ? [
              {
                name: "ChEBI (через EBI OLS)",
                license: "CC BY 4.0",
                url: "https://www.ebi.ac.uk/chebi/",
                usage: "Определения веществ, SMILES, InChIKey, синонимы",
              },
            ]
          : []),
        {
          name: "Rhea, KEGG",
          license: "ссылки",
          url: "https://www.rhea-db.org",
          usage: "Только перекрёстные ссылки, указанные в Reactome; данные не загружаются",
        },
      ],
      coverage: {
        rootPathwayIds: ROOTS,
        note:
          `Импортированы все события раздела Reactome ${ROOTS.join(", ")} для Homo sapiens (релиз ${version}), ` +
          `кроме болезней. Это ручная курируемая база Reactome, а не полная карта метаболизма: часть реакций ` +
          `человека, присутствующих в Rhea/KEGG/MetaCyc/Recon3D, здесь отсутствует. Реакции, выведенные по ортологии ` +
          `из других видов, помечены в источниках.`,
      },
      detailShards: DETAIL_SHARDS,
      importer: { script: "scripts/import/import-reactome.mjs", reactomeRelease: version, chebi: withChebi },
    },
    compartments: [...compartments.values()].sort(sortById),
    metabolites: metList.sort(sortById),
    reactions: reactions.sort(sortById),
    enzymes: [...enzymes.values()].sort(sortById),
    pathways: pathways.sort(sortById),
  };

  await rm(`${OUT_DIR}details`, { recursive: true, force: true });
  await mkdir(`${OUT_DIR}details`, { recursive: true });
  await writeFile(`${OUT_DIR}dataset.json`, JSON.stringify(dataset));
  const shards = Array.from({ length: DETAIL_SHARDS }, () => ({}));
  for (const [id, d] of Object.entries(details)) shards[shardOf(id, DETAIL_SHARDS)][id] = d;
  await Promise.all(shards.map((s, i) => writeFile(`${OUT_DIR}details/${i}.json`, JSON.stringify(s))));

  console.log(
    `\nDone in ${((Date.now() - t0) / 1000).toFixed(0)} s. ` +
      `reactions=${reactions.length} (skipped empty: ${skippedEmpty}), metabolites=${metList.length}, ` +
      `enzymes=${enzymes.size}, pathways=${pathways.length}, compartments=${compartments.size}, details=${Object.keys(details).length}`,
  );
  console.log(`HTTP: network=${stats.network}, cached=${stats.cached}, failed=${stats.failed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
