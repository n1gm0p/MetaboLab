import type {
  Compartment,
  Dataset,
  Enzyme,
  EntityRef,
  Metabolite,
  Pathway,
  Reaction,
} from "@/lib/model/types";

/**
 * In-memory lookup structure built once per dataset.
 * All relationships are derived from reactions; nothing is inferred beyond the source data.
 */
export interface MetaboIndex {
  dataset: Dataset;
  metabolites: Map<string, Metabolite>;
  reactions: Map<string, Reaction>;
  enzymes: Map<string, Enzyme>;
  pathways: Map<string, Pathway>;
  compartments: Map<string, Compartment>;
  /** reactions that consume the metabolite (it is an input) */
  consumedBy: Map<string, string[]>;
  /** reactions that produce the metabolite (it is an output) */
  producedBy: Map<string, string[]>;
  /** same chemical in different compartments */
  byChebi: Map<string, string[]>;
  /** pathway id -> all reactions including sub-pathways */
  pathwayReactionsDeep: Map<string, string[]>;
  /** pathway ids that are not a sub-pathway of anything inside the dataset */
  rootPathwayIds: string[];
  /** metabolite -> pathways (deep) where it takes part */
  metabolitePathways: Map<string, string[]>;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const arr = map.get(key);
  if (arr) {
    if (!arr.includes(value)) arr.push(value);
  } else map.set(key, [value]);
}

export function buildIndex(dataset: Dataset): MetaboIndex {
  const metabolites = new Map(dataset.metabolites.map((m) => [m.id, m]));
  const reactions = new Map(dataset.reactions.map((r) => [r.id, r]));
  const enzymes = new Map(dataset.enzymes.map((e) => [e.id, e]));
  const pathways = new Map(dataset.pathways.map((p) => [p.id, p]));
  const compartments = new Map(dataset.compartments.map((c) => [c.id, c]));

  const consumedBy = new Map<string, string[]>();
  const producedBy = new Map<string, string[]>();
  for (const r of dataset.reactions) {
    for (const i of r.inputs) push(consumedBy, i.metaboliteId, r.id);
    for (const o of r.outputs) push(producedBy, o.metaboliteId, r.id);
  }

  const byChebi = new Map<string, string[]>();
  for (const m of dataset.metabolites) if (m.chebiId) push(byChebi, m.chebiId, m.id);

  const pathwayReactionsDeep = new Map<string, string[]>();
  const collect = (id: string, seen: Set<string>): Set<string> => {
    const out = new Set<string>();
    const p = pathways.get(id);
    if (!p || seen.has(id)) return out;
    seen.add(id);
    for (const r of p.reactionIds) if (reactions.has(r)) out.add(r);
    for (const s of p.subpathwayIds) for (const r of collect(s, seen)) out.add(r);
    return out;
  };
  for (const p of dataset.pathways) pathwayReactionsDeep.set(p.id, [...collect(p.id, new Set())]);

  const childIds = new Set(dataset.pathways.flatMap((p) => p.subpathwayIds));
  const rootPathwayIds = dataset.pathways.filter((p) => !childIds.has(p.id)).map((p) => p.id);

  const metabolitePathways = new Map<string, string[]>();
  for (const [pid, rids] of pathwayReactionsDeep) {
    for (const rid of rids) {
      const r = reactions.get(rid);
      if (!r) continue;
      for (const part of [...r.inputs, ...r.outputs]) push(metabolitePathways, part.metaboliteId, pid);
    }
  }

  return {
    dataset,
    metabolites,
    reactions,
    enzymes,
    pathways,
    compartments,
    consumedBy,
    producedBy,
    byChebi,
    pathwayReactionsDeep,
    rootPathwayIds,
    metabolitePathways,
  };
}

/** All reactions in which a metabolite participates, in either role. */
export function reactionsOfMetabolite(index: MetaboIndex, metaboliteId: string): string[] {
  const out = new Set([...(index.consumedBy.get(metaboliteId) ?? []), ...(index.producedBy.get(metaboliteId) ?? [])]);
  return [...out];
}

/**
 * Reactions where the metabolite effectively *enters* (consumed, or a product of a reversible reaction)
 * and where it *leaves* (produced, or a substrate of a reversible reaction).
 */
export function directionalReactions(index: MetaboIndex, metaboliteId: string) {
  const consumed = index.consumedBy.get(metaboliteId) ?? [];
  const produced = index.producedBy.get(metaboliteId) ?? [];
  return {
    /** reactions producing this metabolite ("откуда образуется") */
    incoming: produced,
    /** reactions consuming this metabolite ("во что превращается") */
    outgoing: consumed,
  };
}

export function displayName(
  index: MetaboIndex,
  ref: EntityRef,
  opts: { preferRu?: boolean } = { preferRu: true },
): string {
  const pick = (o: { name: string; nameRu?: string } | undefined) =>
    o ? (opts.preferRu && o.nameRu ? o.nameRu : o.name) : ref.id;
  switch (ref.type) {
    case "metabolite":
      return pick(index.metabolites.get(ref.id));
    case "reaction":
      return pick(index.reactions.get(ref.id));
    case "enzyme":
      return pick(index.enzymes.get(ref.id));
    case "pathway":
      return pick(index.pathways.get(ref.id));
  }
}

export function compartmentName(index: MetaboIndex, id: string): string {
  const c = index.compartments.get(id);
  return c ? (c.nameRu ?? c.name) : id;
}
