import type { MetaboIndex } from "@/lib/data/metabo-index";
import type { Participant } from "@/lib/model/types";

/**
 * Route search between metabolites over the reaction hypergraph.
 *
 * A "step" moves from one participant of a reaction to another:
 *   substrate i  --(reaction r, forward)-->  product o
 *   product o    --(reaction r, backward)--> substrate i   (only if r is reversible, or in relaxed mode)
 * Currency metabolites (ATP, NAD+, H2O...) are never used as carriers, otherwise every compound
 * would be "two steps" from every other one via ATP.
 *
 * Modes:
 *  - strict:  respects reaction direction AND compartments (a compound must be transported
 *             by a transport reaction to appear in another compartment). This is the
 *             biochemically admissible sequence according to the source data.
 *  - relaxed: ignores direction and merges compartments by ChEBI id. It only shows that the
 *             compounds are *topologically connected* on the map; it is not a biochemical route.
 *
 * Without atom mapping, a step from substrate i to product o does not prove that atoms of i
 * end up in o (e.g. transamination). Steps are therefore presented together with the
 * co-substrates and co-products of the reaction.
 */

export type RouteMode = "strict" | "relaxed";

export interface RouteOptions {
  mode: RouteMode;
  /** number of alternative loop-free routes */
  k: number;
  maxSteps: number;
  excludedReactionIds?: ReadonlySet<string>;
  excludedMetaboliteIds?: ReadonlySet<string>;
  /** treat curated currency metabolites as non-carriers (default true) */
  excludeCurrency?: boolean;
}

export interface RouteStep {
  reactionId: string;
  direction: "forward" | "backward";
  fromId: string;
  toId: string;
  /** other non-currency substrates of the step (must be available for the reaction to proceed) */
  coSubstrates: Participant[];
  coProducts: Participant[];
  /** relaxed mode only: the previous step ended in another compartment */
  compartmentJump: boolean;
}

export interface RoutePath {
  steps: RouteStep[];
  /** metabolite ids visited, in order */
  metaboliteIds: string[];
}

export interface RouteResult {
  mode: RouteMode;
  sourceIds: string[];
  targetIds: string[];
  paths: RoutePath[];
  /** maximum number of steps that was searched; longer routes are not considered */
  maxSteps: number;
}

interface Arc {
  to: string;
  reactionId: string;
  direction: "forward" | "backward";
  /** concrete metabolite ids inside the reaction */
  fromMet: string;
  toMet: string;
}

type Adjacency = Map<string, Arc[]>;

const SUPER_SOURCE = "__source__";
const SUPER_TARGET = "__target__";

const adjacencyCache = new WeakMap<MetaboIndex, Map<string, Adjacency>>();

function nodeKey(index: MetaboIndex, metaboliteId: string, mode: RouteMode): string {
  if (mode === "strict") return metaboliteId;
  return index.metabolites.get(metaboliteId)?.chebiId ?? metaboliteId;
}

export function buildAdjacency(index: MetaboIndex, mode: RouteMode, excludeCurrency = true): Adjacency {
  const cacheKey = `${mode}:${excludeCurrency}`;
  let perIndex = adjacencyCache.get(index);
  if (!perIndex) {
    perIndex = new Map();
    adjacencyCache.set(index, perIndex);
  }
  const cached = perIndex.get(cacheKey);
  if (cached) return cached;

  const adj: Adjacency = new Map();
  const add = (from: string, arc: Arc) => {
    if (from === arc.to) return;
    const list = adj.get(from);
    if (list) list.push(arc);
    else adj.set(from, [arc]);
  };
  const carrier = (id: string) => {
    const m = index.metabolites.get(id);
    return !!m && !(excludeCurrency && m.currency);
  };

  for (const r of index.dataset.reactions) {
    const ins = r.inputs.map((p) => p.metaboliteId).filter(carrier);
    const outs = r.outputs.map((p) => p.metaboliteId).filter(carrier);
    const backward = mode === "relaxed" || r.reversible;
    for (const i of ins) {
      for (const o of outs) {
        if (i === o) continue;
        const ki = nodeKey(index, i, mode);
        const ko = nodeKey(index, o, mode);
        add(ki, { to: ko, reactionId: r.id, direction: "forward", fromMet: i, toMet: o });
        if (backward) add(ko, { to: ki, reactionId: r.id, direction: "backward", fromMet: o, toMet: i });
      }
    }
  }
  perIndex.set(cacheKey, adj);
  return adj;
}

const arcId = (from: string, a: Arc) => `${from}>${a.to}>${a.reactionId}>${a.direction}`;

interface RawPath {
  nodes: string[];
  arcs: Arc[];
}

/** Unweighted BFS (every reaction step costs 1). */
function bfs(
  getArcs: (n: string) => Arc[],
  start: string,
  goal: string,
  removedNodes: ReadonlySet<string>,
  removedArcs: ReadonlySet<string>,
  maxDepth: number,
): RawPath | null {
  const prev = new Map<string, { node: string; arc: Arc } | null>([[start, null]]);
  let frontier = [start];
  for (let depth = 0; depth <= maxDepth && frontier.length; depth++) {
    const next: string[] = [];
    for (const n of frontier) {
      if (n === goal) {
        const nodes: string[] = [];
        const arcs: Arc[] = [];
        let cur: string | undefined = n;
        while (cur !== undefined) {
          nodes.push(cur);
          const p = prev.get(cur);
          if (!p) break;
          arcs.push(p.arc);
          cur = p.node;
        }
        return { nodes: nodes.reverse(), arcs: arcs.reverse() };
      }
      for (const a of getArcs(n)) {
        if (prev.has(a.to) || removedNodes.has(a.to) || removedArcs.has(arcId(n, a))) continue;
        prev.set(a.to, { node: n, arc: a });
        next.push(a.to);
      }
    }
    frontier = next;
  }
  return null;
}

/**
 * Yen's algorithm: up to k shortest loop-free paths. Loop-free paths guarantee that cyclic
 * pathways (TCA, urea cycle) do not produce an infinite number of routes.
 */
export function findRoutes(
  index: MetaboIndex,
  sourceIds: string[],
  targetIds: string[],
  opts: RouteOptions,
): RouteResult {
  const excludeCurrency = opts.excludeCurrency ?? true;
  const adj = buildAdjacency(index, opts.mode, excludeCurrency);
  const sourceKeys = [...new Set(sourceIds.map((s) => nodeKey(index, s, opts.mode)))];
  const targetKeys = new Set(targetIds.map((t) => nodeKey(index, t, opts.mode)));
  const excludedMetKeys = new Set([...(opts.excludedMetaboliteIds ?? [])].map((m) => nodeKey(index, m, opts.mode)));

  const virtualArc = (to: string): Arc => ({ to, reactionId: "", direction: "forward", fromMet: "", toMet: "" });
  const getArcs = (n: string): Arc[] => {
    if (n === SUPER_SOURCE) return sourceKeys.map(virtualArc);
    const arcs = (adj.get(n) ?? []).filter(
      (a) => !opts.excludedReactionIds?.has(a.reactionId) && !excludedMetKeys.has(a.to),
    );
    if (targetKeys.has(n)) arcs.push(virtualArc(SUPER_TARGET));
    return arcs;
  };

  const maxDepth = opts.maxSteps + 2;
  const result: RouteResult = { mode: opts.mode, sourceIds, targetIds, paths: [], maxSteps: opts.maxSteps };
  // Source equals target: nothing to search.
  if (sourceKeys.some((s) => targetKeys.has(s))) return result;

  const first = bfs(getArcs, SUPER_SOURCE, SUPER_TARGET, new Set(), new Set(), maxDepth);
  if (!first) return result;
  const A: RawPath[] = [first];
  const B: RawPath[] = [];
  const pathKey = (p: RawPath) => p.arcs.map((a, i) => arcId(p.nodes[i]!, a)).join("|");
  const known = new Set([pathKey(first)]);

  while (A.length < opts.k) {
    const last = A[A.length - 1]!;
    for (let i = 0; i < last.nodes.length - 1; i++) {
      const spur = last.nodes[i]!;
      const rootNodes = last.nodes.slice(0, i + 1);
      const rootArcs = last.arcs.slice(0, i);
      const removedArcs = new Set<string>();
      for (const p of A) {
        if (p.nodes.length > i && p.nodes.slice(0, i + 1).every((n, j) => n === rootNodes[j])) {
          const a = p.arcs[i];
          if (a) removedArcs.add(arcId(p.nodes[i]!, a));
        }
      }
      const removedNodes = new Set(rootNodes.slice(0, -1));
      const spurPath = bfs(getArcs, spur, SUPER_TARGET, removedNodes, removedArcs, maxDepth - i);
      if (!spurPath) continue;
      const total: RawPath = { nodes: [...rootNodes.slice(0, -1), ...spurPath.nodes], arcs: [...rootArcs, ...spurPath.arcs] };
      const key = pathKey(total);
      if (known.has(key)) continue;
      known.add(key);
      B.push(total);
    }
    if (B.length === 0) break;
    B.sort((a, b) => a.arcs.length - b.arcs.length);
    A.push(B.shift()!);
  }

  result.paths = A.map((p) => toRoutePath(index, p, excludeCurrency)).filter(
    (p) => p.steps.length > 0 && p.steps.length <= opts.maxSteps,
  );
  return result;
}

function toRoutePath(index: MetaboIndex, raw: RawPath, excludeCurrency: boolean): RoutePath {
  const realArcs = raw.arcs.filter((a) => a.reactionId !== "");
  const steps: RouteStep[] = [];
  let prevTo: string | undefined;
  for (const a of realArcs) {
    const r = index.reactions.get(a.reactionId)!;
    const [subs, prods] = a.direction === "forward" ? [r.inputs, r.outputs] : [r.outputs, r.inputs];
    const relevant = (p: Participant) => {
      const m = index.metabolites.get(p.metaboliteId);
      return !!m && !(excludeCurrency && m.currency);
    };
    steps.push({
      reactionId: a.reactionId,
      direction: a.direction,
      fromId: a.fromMet,
      toId: a.toMet,
      coSubstrates: subs.filter((p) => p.metaboliteId !== a.fromMet && relevant(p)),
      coProducts: prods.filter((p) => p.metaboliteId !== a.toMet && relevant(p)),
      compartmentJump: prevTo !== undefined && prevTo !== a.fromMet,
    });
    prevTo = a.toMet;
  }
  const metaboliteIds = steps.length ? [steps[0]!.fromId, ...steps.map((s) => s.toId)] : [];
  return { steps, metaboliteIds };
}
