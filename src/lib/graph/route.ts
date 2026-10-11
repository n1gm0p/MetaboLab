import type { MetaboIndex } from "@/lib/data/metabo-index";
import type { Participant } from "@/lib/model/types";
import { elementBalance } from "@/lib/audit/audit";

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
  /** restrict the search to these reactions (e.g. all reactions of one pathway) */
  allowedReactionIds?: ReadonlySet<string>;
  excludedMetaboliteIds?: ReadonlySet<string>;
  /** treat curated currency metabolites as non-carriers (default true) */
  excludeCurrency?: boolean;
}

/** Why a step is ranked lower or needs caution. Shown next to the step. */
export type StepFlag =
  | "lumped" // Reactome black-box / omitted-steps event
  | "co-substrate" // another non-currency substrate is required
  | "carbon-mismatch" // pairing of an exchange reaction with non-matching carbon counts
  | "transport" // moves the compound between compartments
  | "no-catalyst" // no catalyst recorded in the source
  | "unbalanced" // element balance of the record does not close (H ignored)
  | "class-entity" // step passes through a class of compounds (e.g. "long-chain fatty acid")
  | "compartment-jump"; // relaxed mode only: compartment changes without transport

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
  flags: StepFlag[];
  /** ranking cost of this step (1 = plain explicit reaction) */
  cost: number;
  /** other reactions that perform the same conversion (isoenzymes, alternative cofactors) */
  alternativeReactionIds: string[];
}

export interface CarrierAmount {
  metaboliteId: string;
  label: string;
  amount: number;
}

/**
 * Carriers (ATP, NAD(P)H, FADH2, CoA...) consumed and produced by the reactions of a route,
 * each reaction executed ONCE in the stated direction. Consumption and production are kept
 * separate (not netted). This is a direct count from the stoichiometry of the records, not a
 * physiological energy yield: oxidative phosphorylation, P/O ratios and branch multiplicities
 * are not included.
 */
export interface CarrierBalance {
  consumed: CarrierAmount[];
  produced: CarrierAmount[];
  /** some step yields two or more main products (e.g. aldolase), so per-molecule stoichiometry is not scaled */
  branching: boolean;
}

export type RouteKind = "strict" | "topological";

export interface RouteAssessment {
  kind: RouteKind;
  /** the route relies on lumped events, compound classes, unusual pairings or unbalanced records */
  incomplete: boolean;
  /** human-readable reasons (Russian) */
  reasons: string[];
  compartmentTransitions: number;
}

export interface RoutePath {
  steps: RouteStep[];
  /** metabolite ids visited, in order */
  metaboliteIds: string[];
  /** total ranking cost (lower = preferred) */
  cost: number;
  assessment: RouteAssessment;
  carriers: CarrierBalance;
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
  /** step cost: lumped / uncertain events cost more than explicit reactions */
  weight: number;
  flags: StepFlag[];
}

/** Reactome "black box" / omitted-step events summarise several reactions; prefer explicit steps. */
const LUMPED_WEIGHT = 4;
/**
 * Extra cost when the step has another non-currency substrate. Without atom mapping a pairing such as
 * "G6P + 1,3-BPG -> G1,6BP + 3PG" would otherwise let the search jump G6P -> 3PG. This only ranks
 * routes; such steps are still allowed and their co-substrates are always shown.
 */
const CO_SUBSTRATE_PENALTY = 5;
/**
 * In exchange reactions (>= 2 main substrates and >= 2 main products, e.g. transamination
 * Ala + 2-OG -> Pyr + Glu) a substrate is paired preferentially with the product(s) whose carbon
 * count is closest; other pairings are kept but ranked much lower.
 */
const CARBON_MISMATCH_PENALTY = 10;
/**
 * Extra cost for reactions without a recorded catalyst (and not transport): some are genuine
 * spontaneous steps, but many are side reactions (e.g. non-enzymatic oxidation by H2O2) that
 * should not outrank the enzymatic route. Ranking only.
 */
const NO_CATALYST_PENALTY = 3;

/** Number of carbon atoms from a Hill formula; undefined when unknown. */
export function carbonCount(formula: string | undefined): number | undefined {
  if (!formula) return undefined;
  const m = formula.match(/C(?![a-z])(\d*)/);
  if (!m) return 0;
  return m[1] ? Number(m[1]) : 1;
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
    const lumped = r.category === "black-box" || r.category === "omitted" || r.category === "uncertain";
    const weight = (lumped ? LUMPED_WEIGHT : 1) + (r.enzymeIds.length === 0 && !r.isTransport ? NO_CATALYST_PENALTY : 0);
    const fwdPenalty = ins.length > 1 ? CO_SUBSTRATE_PENALTY : 0;
    const bwdPenalty = outs.length > 1 ? CO_SUBSTRATE_PENALTY : 0;
    const exchange = ins.length >= 2 && outs.length >= 2;
    const carbons = (id: string) => carbonCount(index.metabolites.get(id)?.formula);
    /** true when `a` -> `b` is not among the closest carbon-count pairings of `a` */
    const mismatch = (a: string, candidates: string[], b: string) => {
      if (!exchange) return false;
      const ca = carbons(a);
      const cb = carbons(b);
      if (ca === undefined || cb === undefined) return false;
      const diffs = candidates.map((c) => carbons(c)).filter((c): c is number => c !== undefined).map((c) => Math.abs(c - ca));
      return Math.abs(cb - ca) > Math.min(...diffs);
    };
    for (const i of ins) {
      for (const o of outs) {
        if (i === o) continue;
        const ki = nodeKey(index, i, mode);
        const ko = nodeKey(index, o, mode);
        const flagsFor = (penalty: number, mm: boolean): StepFlag[] => [
          ...(lumped ? (["lumped"] as const) : []),
          ...(penalty ? (["co-substrate"] as const) : []),
          ...(mm ? (["carbon-mismatch"] as const) : []),
        ];
        const fwMismatch = mismatch(i, outs, o);
        const fw = weight + fwdPenalty + (fwMismatch ? CARBON_MISMATCH_PENALTY : 0);
        add(ki, { to: ko, reactionId: r.id, direction: "forward", fromMet: i, toMet: o, weight: fw, flags: flagsFor(fwdPenalty, fwMismatch) });
        if (backward) {
          const bwMismatch = mismatch(o, ins, i);
          const bw = weight + bwdPenalty + (bwMismatch ? CARBON_MISMATCH_PENALTY : 0);
          add(ko, { to: ki, reactionId: r.id, direction: "backward", fromMet: o, toMet: i, weight: bw, flags: flagsFor(bwdPenalty, bwMismatch) });
        }
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

const pathCost = (p: RawPath) => p.arcs.reduce((sum, a) => sum + a.weight, 0);

/** Minimal binary heap keyed by cost. */
class MinHeap<T> {
  private items: { cost: number; value: T }[] = [];
  get size() {
    return this.items.length;
  }
  push(cost: number, value: T) {
    const a = this.items;
    a.push({ cost, value });
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent]!.cost <= a[i]!.cost) break;
      [a[parent], a[i]] = [a[i]!, a[parent]!];
      i = parent;
    }
  }
  pop(): { cost: number; value: T } | undefined {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0 && last) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l]!.cost < a[m]!.cost) m = l;
        if (r < a.length && a[r]!.cost < a[m]!.cost) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}

/** Dijkstra over weighted steps with a hop limit. */
function shortestPath(
  getArcs: (n: string) => Arc[],
  start: string,
  goal: string,
  removedNodes: ReadonlySet<string>,
  removedArcs: ReadonlySet<string>,
  maxDepth: number,
): RawPath | null {
  const best = new Map<string, number>([[start, 0]]);
  const prev = new Map<string, { node: string; arc: Arc }>();
  const hops = new Map<string, number>([[start, 0]]);
  const heap = new MinHeap<string>();
  heap.push(0, start);
  while (heap.size) {
    const { cost, value: n } = heap.pop()!;
    if (cost > (best.get(n) ?? Infinity)) continue;
    if (n === goal) {
      const nodes = [n];
      const arcs: Arc[] = [];
      let cur = n;
      for (let p = prev.get(cur); p; p = prev.get(cur)) {
        arcs.push(p.arc);
        nodes.push(p.node);
        cur = p.node;
      }
      return { nodes: nodes.reverse(), arcs: arcs.reverse() };
    }
    const h = hops.get(n)!;
    if (h >= maxDepth) continue;
    for (const a of getArcs(n)) {
      if (removedNodes.has(a.to) || removedArcs.has(arcId(n, a))) continue;
      const c = cost + a.weight;
      if (c < (best.get(a.to) ?? Infinity)) {
        best.set(a.to, c);
        prev.set(a.to, { node: n, arc: a });
        hops.set(a.to, h + 1);
        heap.push(c, a.to);
      }
    }
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

  const virtualArc = (to: string): Arc => ({ to, reactionId: "", direction: "forward", fromMet: "", toMet: "", weight: 0, flags: [] });
  const getArcs = (n: string): Arc[] => {
    if (n === SUPER_SOURCE) return sourceKeys.map(virtualArc);
    const arcs = (adj.get(n) ?? []).filter(
      (a) =>
        !opts.excludedReactionIds?.has(a.reactionId) &&
        (!opts.allowedReactionIds || opts.allowedReactionIds.has(a.reactionId)) &&
        !excludedMetKeys.has(a.to),
    );
    if (targetKeys.has(n)) arcs.push(virtualArc(SUPER_TARGET));
    return arcs;
  };

  const maxDepth = opts.maxSteps + 2;
  const result: RouteResult = { mode: opts.mode, sourceIds, targetIds, paths: [], maxSteps: opts.maxSteps };
  // Source equals target: nothing to search.
  if (sourceKeys.some((s) => targetKeys.has(s))) return result;

  const first = shortestPath(getArcs, SUPER_SOURCE, SUPER_TARGET, new Set(), new Set(), maxDepth);
  if (!first) return result;
  const A: RawPath[] = [first];
  const B: RawPath[] = [];
  const pathKey = (p: RawPath) => p.arcs.map((a, i) => arcId(p.nodes[i]!, a)).join("|");
  const known = new Set([pathKey(first)]);

  // Search more raw paths than requested: variants differing only by isoenzyme reactions are
  // merged below so that the user sees genuinely different sequences of compounds.
  const rawLimit = opts.k * 4;
  while (A.length < rawLimit) {
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
      const spurPath = shortestPath(getArcs, spur, SUPER_TARGET, removedNodes, removedArcs, maxDepth - i);
      if (!spurPath) continue;
      const total: RawPath = { nodes: [...rootNodes.slice(0, -1), ...spurPath.nodes], arcs: [...rootArcs, ...spurPath.arcs] };
      const key = pathKey(total);
      if (known.has(key)) continue;
      known.add(key);
      B.push(total);
    }
    if (B.length === 0) break;
    B.sort((a, b) => pathCost(a) - pathCost(b) || a.arcs.length - b.arcs.length);
    A.push(B.shift()!);
  }

  const bySequence = new Map<string, RoutePath>();
  for (const raw of A) {
    const p = toRoutePath(index, raw, excludeCurrency, opts.mode);
    if (p.steps.length === 0 || p.steps.length > opts.maxSteps) continue;
    const seq = p.metaboliteIds.join(">");
    const existing = bySequence.get(seq);
    if (existing) {
      // same chain of compounds via other reactions: keep them as per-step alternatives
      p.steps.forEach((st, i) => {
        const target = existing.steps[i];
        if (target && st.reactionId !== target.reactionId && !target.alternativeReactionIds.includes(st.reactionId))
          target.alternativeReactionIds.push(st.reactionId);
      });
      continue;
    }
    if (result.paths.length >= opts.k) continue;
    bySequence.set(seq, p);
    result.paths.push(p);
  }
  return result;
}

const FLAG_REASON: Record<StepFlag, string> = {
  lumped: "используются суммарные события Reactome (промежуточные стадии не показаны)",
  "co-substrate": "есть шаги, требующие дополнительных субстратов",
  "carbon-mismatch": "есть шаги обменных реакций, где переход вещества по числу атомов C сомнителен",
  transport: "есть транспорт между компартментами",
  "no-catalyst": "для части реакций катализатор в источнике не указан",
  unbalanced: "для части реакций баланс элементов по формулам не сходится",
  "class-entity": "маршрут проходит через группы веществ, а не конкретные соединения",
  "compartment-jump": "компартмент меняется без транспортной реакции",
};

/** Flags that make a route "incomplete" (information-wise), as opposed to merely noteworthy. */
const INCOMPLETE_FLAGS: ReadonlySet<StepFlag> = new Set<StepFlag>(["lumped", "carbon-mismatch", "unbalanced", "class-entity", "compartment-jump"]);

function toRoutePath(index: MetaboIndex, raw: RawPath, excludeCurrency: boolean, mode: RouteMode): RoutePath {
  const realArcs = raw.arcs.filter((a) => a.reactionId !== "");
  const steps: RouteStep[] = [];
  const consumed = new Map<string, number>();
  const produced = new Map<string, number>();
  let branching = false;
  let prevTo: string | undefined;
  for (const a of realArcs) {
    const r = index.reactions.get(a.reactionId)!;
    const [subs, prods] = a.direction === "forward" ? [r.inputs, r.outputs] : [r.outputs, r.inputs];
    const relevant = (p: Participant) => {
      const m = index.metabolites.get(p.metaboliteId);
      return !!m && !(excludeCurrency && m.currency);
    };
    const coProducts = prods.filter((p) => p.metaboliteId !== a.toMet && relevant(p));
    const jump = prevTo !== undefined && prevTo !== a.fromMet;
    const flags = new Set<StepFlag>(a.flags);
    if (r.isTransport) flags.add("transport");
    if (r.enzymeIds.length === 0) flags.add("no-catalyst");
    if (elementBalance(r, index.metabolites).status === "unbalanced") flags.add("unbalanced");
    if ([a.fromMet, a.toMet].some((id) => index.metabolites.get(id)?.kind === "set")) flags.add("class-entity");
    if (
      mode === "relaxed" &&
      jump &&
      index.metabolites.get(prevTo!)?.compartmentId !== index.metabolites.get(a.fromMet)?.compartmentId
    )
      flags.add("compartment-jump");
    if (coProducts.length > 0) branching = true;
    for (const p of subs)
      if (index.metabolites.get(p.metaboliteId)?.currency) consumed.set(p.metaboliteId, (consumed.get(p.metaboliteId) ?? 0) + p.stoichiometry);
    for (const p of prods)
      if (index.metabolites.get(p.metaboliteId)?.currency) produced.set(p.metaboliteId, (produced.get(p.metaboliteId) ?? 0) + p.stoichiometry);
    steps.push({
      reactionId: a.reactionId,
      direction: a.direction,
      fromId: a.fromMet,
      toId: a.toMet,
      coSubstrates: subs.filter((p) => p.metaboliteId !== a.fromMet && relevant(p)),
      coProducts,
      compartmentJump: jump,
      flags: [...flags],
      cost: a.weight,
      alternativeReactionIds: [],
    });
    prevTo = a.toMet;
  }
  const metaboliteIds = steps.length ? [steps[0]!.fromId, ...steps.map((s) => s.toId)] : [];
  const allFlags = new Set(steps.flatMap((s) => s.flags));
  const reasons = [...allFlags].map((f) => FLAG_REASON[f]);
  if (mode === "relaxed")
    reasons.unshift("топологический режим: направление реакций и компартменты не учитываются — это не биохимический путь");
  const toAmounts = (m: Map<string, number>): CarrierAmount[] =>
    [...m.entries()]
      .map(([id, amount]) => {
        const met = index.metabolites.get(id);
        return { metaboliteId: id, label: met?.abbreviation ?? met?.name ?? id, amount };
      })
      .sort((x, y) => x.label.localeCompare(y.label));
  return {
    steps,
    metaboliteIds,
    cost: steps.reduce((sum, st) => sum + st.cost, 0),
    assessment: {
      kind: mode === "strict" ? "strict" : "topological",
      incomplete: [...allFlags].some((f) => INCOMPLETE_FLAGS.has(f)),
      reasons,
      compartmentTransitions: steps.filter((st) => st.flags.includes("transport") || st.flags.includes("compartment-jump")).length,
    },
    carriers: { consumed: toAmounts(consumed), produced: toAmounts(produced), branching },
  };
}
