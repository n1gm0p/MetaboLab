#!/usr/bin/env node
// Re-checks records flagged by the data audit directly against the Reactome ContentService.
// Purpose: distinguish IMPORT errors (our data differs from the source) from properties of the
// SOURCE itself (our data reproduces the source faithfully). Nothing in public/data is modified.
//
// Usage: node scripts/audit/verify-source.mjs
// Output: data-review/source-verification.json
// Uses the importer's on-disk HTTP cache (scripts/import/.cache).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chunk, fetchJson, mapAll, stats } from "../import/lib/http.mjs";

const CS = "https://reactome.org/ContentService";
const root = new URL("../../", import.meta.url);
const ds = JSON.parse(readFileSync(new URL("public/data/dataset.json", root), "utf8"));
const audit = JSON.parse(readFileSync(new URL("public/data/audit.json", root), "utf8"));

const asArray = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const refId = (x) => (typeof x === "number" ? x : x?.dbId);
const goId = (c) => (c?.accession ? `GO:${c.accession}` : undefined);

async function queryIds(ids, label) {
  const out = new Map();
  await mapAll(
    chunk([...new Set(ids.map(String))], 20),
    async (batch) => {
      const res = await fetchJson(`${CS}/data/query/ids`, { method: "POST", body: batch.join(","), headers: { "Content-Type": "text/plain" } });
      for (const o of asArray(res)) if (o && typeof o === "object") out.set(o.dbId, o);
    },
    label,
  );
  return out;
}

// --- which reactions to verify: every reaction named in a reaction-level audit category
const REACTION_CATEGORIES = new Set([
  "rxn-unbalanced",
  "rxn-compartment-mismatch",
  "rxn-no-catalyst",
  "rxn-no-ec",
  "same-both-sides",
  "dup-equation-same-catalyst",
]);
// The audit report only keeps examples; recompute full membership from the dataset instead.
const M = new Map(ds.metabolites.map((m) => [m.id, m]));
const flagged = new Set();
for (const r of ds.reactions) {
  const comps = new Set(r.compartmentIds);
  if ([...r.inputs, ...r.outputs].some((p) => !comps.has(M.get(p.metaboliteId)?.compartmentId))) flagged.add(r.id);
  if (r.enzymeIds.length === 0 || r.ecNumbers.length === 0) flagged.add(r.id);
  const ins = new Set(r.inputs.map((p) => p.metaboliteId));
  if (r.outputs.some((p) => ins.has(p.metaboliteId))) flagged.add(r.id);
}
for (const c of audit.categories)
  if (REACTION_CATEGORIES.has(c.id)) for (const e of c.examples) for (const id of e.match(/R-[A-Z]{3}-\d+/g) ?? []) flagged.add(id);
// unbalanced reactions: recompute (examples are capped)
for (const c of audit.categories) if (REACTION_CATEGORIES.has(c.id)) for (const id of c.recordIds ?? []) if (/^R-[A-Z]{3}-\d+$/.test(id)) flagged.add(id);

console.log(`Reactions to verify: ${flagged.size}`);
const events = await queryIds([...flagged], "reactions");
const byStId = new Map([...events.values()].map((e) => [e.stId, e]));

const peIds = new Set();
const caIds = new Set();
for (const e of events.values()) {
  for (const x of [...asArray(e.input), ...asArray(e.output)]) peIds.add(refId(x));
  for (const x of asArray(e.catalystActivity)) caIds.add(refId(x));
}
const pes = await queryIds([...peIds], "participants");
const cas = await queryIds([...caIds], "catalyst activities");

const count = (list) => {
  const m = new Map();
  for (const x of asArray(list)) {
    const pe = pes.get(refId(x));
    const key = pe?.stId ?? `dbId:${refId(x)}`;
    m.set(key, (m.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...m.entries()].sort());
};
const ours = (parts) => Object.fromEntries(parts.map((p) => [p.metaboliteId, p.stoichiometry]).sort((a, b) => (a[0] < b[0] ? -1 : 1)));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const results = [];
for (const r of ds.reactions) {
  if (!flagged.has(r.id)) continue;
  const e = byStId.get(r.id);
  if (!e) {
    results.push({ id: r.id, found: false });
    continue;
  }
  const srcIn = count(e.input);
  const srcOut = count(e.output);
  const srcCompartments = asArray(e.compartment).map(goId).filter(Boolean).sort();
  const participantCompartments = {};
  for (const x of [...asArray(e.input), ...asArray(e.output)]) {
    const pe = pes.get(refId(x));
    if (pe) participantCompartments[pe.stId] = asArray(pe.compartment).map(goId).filter(Boolean);
  }
  const participants = Object.fromEntries(
    [...new Set([...Object.keys(srcIn), ...Object.keys(srcOut)])].map((stId) => {
      const pe = [...pes.values()].find((p) => p.stId === stId);
      const ref = pe?.referenceEntity && typeof pe.referenceEntity === "object" ? pe.referenceEntity : undefined;
      return [
        stId,
        {
          name: pe?.displayName,
          schemaClass: pe?.schemaClass,
          chebi: ref?.databaseName === "ChEBI" ? `CHEBI:${ref.identifier}` : undefined,
          formula: ref?.formula,
        },
      ];
    }),
  );
  const srcCatalysts = asArray(e.catalystActivity).map((x) => {
    const ca = cas.get(refId(x));
    return {
      activity: ca?.activity?.name ?? null,
      ecNumber: ca?.activity?.ecNumber ?? null,
      physicalEntity: ca ? (typeof ca.physicalEntity === "object" ? ca.physicalEntity.stId : ca.physicalEntity) : null,
    };
  });
  results.push({
    id: r.id,
    found: true,
    name: e.displayName,
    schemaClass: e.schemaClass,
    category: e.category,
    url: `https://reactome.org/content/detail/${r.id}`,
    source: { inputs: srcIn, outputs: srcOut, compartments: srcCompartments, participantCompartments, participants, catalysts: srcCatalysts },
    matches: {
      inputs: same(srcIn, ours(r.inputs)),
      outputs: same(srcOut, ours(r.outputs)),
      compartments: same(srcCompartments, [...r.compartmentIds].sort()),
      catalystCount: srcCatalysts.length === r.enzymeIds.length || (srcCatalysts.length > 0 && r.enzymeIds.length > 0),
      ecNumbers: same(
        [...new Set(srcCatalysts.map((c) => c.ecNumber).filter(Boolean).flatMap((x) => String(x).split(/[,;\s]+/)))].sort(),
        [...r.ecNumbers].sort(),
      ),
    },
  });
}

mkdirSync(new URL("data-review/", root), { recursive: true });
writeFileSync(
  new URL("data-review/source-verification.json", root),
  JSON.stringify({ verifiedAt: new Date().toISOString(), datasetGeneratedAt: ds.meta.generatedAt, reactions: results }, null, 1),
);
const mism = (k) => results.filter((x) => x.found && !x.matches[k]).map((x) => x.id);
console.log(`verified ${results.length}; not found ${results.filter((x) => !x.found).length}`);
for (const k of ["inputs", "outputs", "compartments", "catalystCount", "ecNumbers"]) console.log(`  mismatch ${k}: ${mism(k).length} ${mism(k).slice(0, 12).join(" ")}`);
console.log(`HTTP: network=${stats.network}, cached=${stats.cached}, failed=${stats.failed}`);
