import type { MetaboIndex } from "@/lib/data/metabo-index";
import { reactionsOfMetabolite } from "@/lib/data/metabo-index";

/**
 * Bipartite directed graph: metabolite nodes and reaction nodes.
 * Edges only go metabolite -> reaction (substrate) or reaction -> metabolite (product).
 * There are never direct metabolite -> metabolite edges: two compounds of the same reaction
 * are connected only through that reaction node.
 */

export type CofactorMode = "duplicate" | "shared" | "hide";

export interface GraphNode {
  id: string;
  kind: "metabolite" | "reaction";
  /** id of the underlying Metabolite / Reaction */
  refId: string;
  label: string;
  compartmentId?: string;
  /** ChEBI id of the metabolite (used to place it on the fixed teaching skeleton) */
  chebiId?: string;
  currency?: boolean;
  /** currency metabolite cloned for a single reaction */
  clone?: boolean;
  reversible?: boolean;
  isTransport?: boolean;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  role: "substrate" | "product";
  stoichiometry: number;
  reactionId: string;
  metaboliteId: string;
  /** the reaction can also run backwards; edge is drawn with arrows on both ends */
  reversible: boolean;
}

export interface GraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface BuildOptions {
  cofactorMode: CofactorMode;
  preferRu: boolean;
  /** metabolites the user hid from the map */
  hiddenMetaboliteIds?: ReadonlySet<string>;
}

export const metaboliteNodeId = (metaboliteId: string) => `m:${metaboliteId}`;
export const reactionNodeId = (reactionId: string) => `r:${reactionId}`;

export function metaboliteLabel(index: MetaboIndex, id: string, preferRu: boolean): string {
  const m = index.metabolites.get(id);
  if (!m) return id;
  if (m.currency && m.abbreviation) return m.abbreviation;
  return (preferRu && m.nameRu) || m.abbreviation || m.name;
}

export function buildGraph(index: MetaboIndex, reactionIds: Iterable<string>, opts: BuildOptions): GraphModel {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  for (const rid of reactionIds) {
    const r = index.reactions.get(rid);
    if (!r) continue;
    const rNode = reactionNodeId(r.id);
    nodes.set(rNode, {
      id: rNode,
      kind: "reaction",
      refId: r.id,
      label: r.ecNumbers[0] ?? "",
      reversible: r.reversible,
      isTransport: r.isTransport,
    });

    const addSide = (role: GraphEdge["role"]) => {
      const parts = role === "substrate" ? r.inputs : r.outputs;
      for (const part of parts) {
        const m = index.metabolites.get(part.metaboliteId);
        if (!m) continue;
        if (m.currency && opts.cofactorMode === "hide") continue;
        if (opts.hiddenMetaboliteIds?.has(m.id)) continue;
        const clone = m.currency && opts.cofactorMode === "duplicate";
        const mNode = clone ? `${metaboliteNodeId(m.id)}@${r.id}` : metaboliteNodeId(m.id);
        if (!nodes.has(mNode)) {
          nodes.set(mNode, {
            id: mNode,
            kind: "metabolite",
            refId: m.id,
            label: metaboliteLabel(index, m.id, opts.preferRu),
            compartmentId: m.compartmentId,
            chebiId: m.chebiId,
            currency: m.currency,
            clone,
          });
        }
        const [source, target] = role === "substrate" ? [mNode, rNode] : [rNode, mNode];
        edges.push({
          id: `${role === "substrate" ? "s" : "p"}:${m.id}:${r.id}`,
          source,
          target,
          role,
          stoichiometry: part.stoichiometry,
          reactionId: r.id,
          metaboliteId: m.id,
          reversible: r.reversible,
        });
      }
    };
    addSide("substrate");
    addSide("product");
  }
  // De-duplicate edges (a metabolite listed twice on one side is already aggregated by stoichiometry)
  const seen = new Set<string>();
  const uniqueEdges = edges.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
  return { nodes: [...nodes.values()], edges: uniqueEdges };
}

/**
 * Reactions within `depth` reaction-steps of a metabolite.
 * Expansion never passes *through* currency metabolites (ATP, H2O...), otherwise one step
 * would pull in hundreds of unrelated reactions.
 */
export function neighborhoodReactions(
  index: MetaboIndex,
  metaboliteId: string,
  depth = 1,
  maxReactions = 120,
): string[] {
  const result = new Set<string>();
  let frontier = [metaboliteId];
  const visitedMets = new Set(frontier);
  for (let d = 0; d < depth && frontier.length > 0; d++) {
    const next: string[] = [];
    for (const mid of frontier) {
      for (const rid of reactionsOfMetabolite(index, mid)) {
        if (result.size >= maxReactions) return [...result];
        if (result.has(rid)) continue;
        result.add(rid);
        const r = index.reactions.get(rid);
        if (!r) continue;
        for (const part of [...r.inputs, ...r.outputs]) {
          const m = index.metabolites.get(part.metaboliteId);
          if (!m || m.currency || visitedMets.has(m.id)) continue;
          visitedMets.add(m.id);
          next.push(m.id);
        }
      }
    }
    frontier = next;
  }
  return [...result];
}
