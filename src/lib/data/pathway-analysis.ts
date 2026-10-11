import type { MetaboIndex } from "./metabo-index";

/**
 * Derived (computed, not curated) properties of pathways.
 * Everything here follows mechanically from the reactions of the dataset.
 */

export interface PathwayBoundary {
  /** non-currency compounds consumed by the pathway but not produced inside it */
  inputs: string[];
  /** non-currency compounds produced by the pathway but not consumed inside it */
  outputs: string[];
}

export function pathwayBoundary(index: MetaboIndex, pathwayId: string): PathwayBoundary {
  const consumed = new Set<string>();
  const produced = new Set<string>();
  for (const rid of index.pathwayReactionsDeep.get(pathwayId) ?? []) {
    const r = index.reactions.get(rid);
    if (!r) continue;
    for (const p of r.inputs) consumed.add(p.metaboliteId);
    for (const p of r.outputs) produced.add(p.metaboliteId);
    if (r.reversible) {
      for (const p of r.inputs) produced.add(p.metaboliteId);
      for (const p of r.outputs) consumed.add(p.metaboliteId);
    }
  }
  // proteins and complexes participate in reactions but are not metabolic inputs/outputs
  const relevant = (id: string) => {
    const m = index.metabolites.get(id);
    return !!m && !m.currency && (m.kind === "small-molecule" || m.kind === "set");
  };
  return {
    inputs: [...consumed].filter((m) => !produced.has(m) && relevant(m)),
    outputs: [...produced].filter((m) => !consumed.has(m) && relevant(m)),
  };
}

export interface PathwayLink {
  pathwayId: string;
  sharedMetaboliteIds: string[];
}

/**
 * Pathways sharing non-currency compounds (same compartment-specific entity) with the given one.
 * Only pathways that contain reactions directly ("leaf-level") are compared, so that the
 * parent categories ("Metabolism") do not dominate the list.
 */
export function linkedPathways(index: MetaboIndex, pathwayId: string, limit = 12): PathwayLink[] {
  const own = new Set(index.pathwayReactionsDeep.get(pathwayId) ?? []);
  const mets = new Set<string>();
  for (const rid of own) {
    const r = index.reactions.get(rid);
    for (const p of [...(r?.inputs ?? []), ...(r?.outputs ?? [])]) {
      const m = index.metabolites.get(p.metaboliteId);
      if (m && !m.currency && (m.kind === "small-molecule" || m.kind === "set")) mets.add(p.metaboliteId);
    }
  }
  const ancestors = new Set<string>();
  const addAnc = (id: string) => {
    for (const parent of index.pathways.get(id)?.parentIds ?? []) {
      if (!ancestors.has(parent)) {
        ancestors.add(parent);
        addAnc(parent);
      }
    }
  };
  addAnc(pathwayId);
  const descendants = new Set<string>();
  const addDesc = (id: string) => {
    for (const c of index.pathways.get(id)?.subpathwayIds ?? []) {
      if (!descendants.has(c)) {
        descendants.add(c);
        addDesc(c);
      }
    }
  };
  addDesc(pathwayId);

  const shared = new Map<string, Set<string>>();
  for (const m of mets) {
    for (const pid of index.metabolitePathways.get(m) ?? []) {
      if (pid === pathwayId || ancestors.has(pid) || descendants.has(pid)) continue;
      const p = index.pathways.get(pid);
      if (!p || p.reactionIds.length === 0) continue;
      let s = shared.get(pid);
      if (!s) shared.set(pid, (s = new Set()));
      s.add(m);
    }
  }
  return [...shared.entries()]
    .map(([pid, s]) => ({ pathwayId: pid, sharedMetaboliteIds: [...s] }))
    .sort((a, b) => b.sharedMetaboliteIds.length - a.sharedMetaboliteIds.length)
    .slice(0, limit);
}

const isMain = (index: MetaboIndex, id: string) => {
  const m = index.metabolites.get(id);
  return !!m && !m.currency && (m.kind === "small-molecule" || m.kind === "set");
};

export interface PathwayOrder {
  /** reactions in a reading order: a reaction comes after the reactions producing its main substrates */
  reactionIds: string[];
  /** the pathway contains a cycle (e.g. TCA, urea cycle); the order starts at an entry point */
  cyclic: boolean;
}

/**
 * Reading order of the reactions of a pathway (computed): Kahn's topological sort over
 * "product of A is a main substrate of B" links inside the pathway. Cycles are broken at the
 * reaction with the fewest unresolved predecessors, keeping the source order on ties.
 */
export function orderPathwayReactions(index: MetaboIndex, pathwayId: string): PathwayOrder {
  const rids = index.pathwayReactionsDeep.get(pathwayId) ?? [];
  const producers = new Map<string, string[]>();
  for (const rid of rids)
    for (const p of index.reactions.get(rid)?.outputs ?? [])
      if (isMain(index, p.metaboliteId)) producers.set(p.metaboliteId, [...(producers.get(p.metaboliteId) ?? []), rid]);
  const preds = new Map<string, Set<string>>();
  for (const rid of rids) {
    const set = new Set<string>();
    for (const p of index.reactions.get(rid)?.inputs ?? [])
      for (const q of producers.get(p.metaboliteId) ?? []) if (q !== rid) set.add(q);
    preds.set(rid, set);
  }
  const done = new Set<string>();
  const order: string[] = [];
  let cyclic = false;
  while (order.length < rids.length) {
    const ready = rids.filter((r) => !done.has(r) && [...preds.get(r)!].every((q) => done.has(q)));
    let next = ready[0];
    if (!next) {
      cyclic = true;
      const pending = rids.filter((r) => !done.has(r));
      next = pending.reduce((best, r) => {
        const open = (x: string) => [...preds.get(x)!].filter((q) => !done.has(q)).length;
        return open(r) < open(best) ? r : best;
      }, pending[0]!);
    }
    done.add(next);
    order.push(next);
  }
  return { reactionIds: order, cyclic };
}

/** Main compounds consumed by two or more reactions of the pathway: alternative branches start here. */
export function branchPoints(index: MetaboIndex, pathwayId: string): { metaboliteId: string; reactionIds: string[] }[] {
  const consumers = new Map<string, string[]>();
  for (const rid of index.pathwayReactionsDeep.get(pathwayId) ?? [])
    for (const p of index.reactions.get(rid)?.inputs ?? [])
      if (isMain(index, p.metaboliteId) && index.metabolites.get(p.metaboliteId)?.kind === "small-molecule")
        consumers.set(p.metaboliteId, [...(consumers.get(p.metaboliteId) ?? []), rid]);
  return [...consumers.entries()]
    .filter(([, list]) => list.length >= 2)
    .map(([metaboliteId, reactionIds]) => ({ metaboliteId, reactionIds }))
    .sort((a, b) => b.reactionIds.length - a.reactionIds.length);
}

/** Reactions of the pathway with regulation recorded in the source. */
export function regulatedSteps(index: MetaboIndex, pathwayId: string): string[] {
  return (index.pathwayReactionsDeep.get(pathwayId) ?? []).filter((rid) => (index.reactions.get(rid)?.regulation.length ?? 0) > 0);
}

/** Compartments where the pathway's reactions take place, with reaction counts. */
export function pathwayCompartments(index: MetaboIndex, pathwayId: string): [string, number][] {
  const counts = new Map<string, number>();
  for (const rid of index.pathwayReactionsDeep.get(pathwayId) ?? [])
    for (const c of index.reactions.get(rid)?.compartmentIds ?? []) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}
