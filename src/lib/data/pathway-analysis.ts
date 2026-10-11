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
