// Per-record review of audit findings, for manual checking.
// Combines: (1) the dataset, (2) an optional re-check against the Reactome source
// (data-review/source-verification.json, produced by scripts/audit/verify-source.mjs) and
// (3) optional documented manual decisions (data-review/decisions.json).
// Explanations produced by rules are labelled as such; nothing here changes the data.
// Only type imports + relative runtime imports with extensions, so it runs under Node strip-types.
import type { Dataset, Metabolite, Reaction } from "../model/types";
import { compartmentMismatch, elementBalance, parseFormula } from "./audit.ts";

export type ReviewStatus = "unreviewed" | "checked" | "confirmed-error" | "accepted-exception";

export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  unreviewed: "не проверено",
  checked: "проверено",
  "confirmed-error": "подтверждённая ошибка",
  "accepted-exception": "допустимое исключение",
};

export interface ReviewItem {
  category: string;
  recordId: string;
  severity: "error" | "warning" | "info";
  status: ReviewStatus;
  /** a biochemist should look at it: the rule could not explain it, or the source looks wrong */
  needsExpert: boolean;
  /** the finding probably reflects an error in the SOURCE record (data left unchanged) */
  suspectedSourceIssue?: boolean;
  explanation: string;
  /** how the explanation was obtained */
  basis: "rule" | "source-check" | "manual";
  sourceUrl: string;
  data?: Record<string, unknown>;
}

export interface SourceVerificationEntry {
  id: string;
  found: boolean;
  matches?: { inputs: boolean; outputs: boolean; compartments: boolean; catalystCount: boolean; ecNumbers: boolean };
  source?: { catalysts: { activity: string | null; ecNumber: string | null }[] };
}
export interface SourceVerification {
  verifiedAt: string;
  datasetGeneratedAt: string;
  reactions: SourceVerificationEntry[];
}

export interface ManualDecision {
  category: string;
  recordId: string;
  status: ReviewStatus;
  needsExpert: boolean;
  suspectedSourceIssue?: boolean;
  explanation: string;
  reviewer: string;
  date: string;
}

/** Small species whose absence typically explains an element imbalance (substrates − products). */
const MISSING_SPECIES: { label: string; delta: Record<string, number> }[] = [
  { label: "CO₂", delta: { C: 1, O: 2 } },
  { label: "формальдегид (CH₂O)", delta: { C: 1, O: 1 } },
  { label: "Pi", delta: { O: 4, P: 1 } },
  { label: "PPi", delta: { O: 7, P: 2 } },
  { label: "NH₃", delta: { N: 1 } },
  { label: "SO₄²⁻", delta: { O: 4, S: 1 } },
  { label: "НАДФ(Н)", delta: { C: 21, N: 7, O: 17, P: 3 } },
  { label: "НАД(Н)", delta: { C: 21, N: 7, O: 14, P: 2 } },
  { label: "ацетил", delta: { C: 2, O: 1 } },
];

/** k such that diff = k × delta (k ≠ 0, integer), or null */
function multipleOf(diff: Record<string, number>, delta: Record<string, number>): number | null {
  const keys = new Set([...Object.keys(diff), ...Object.keys(delta)]);
  let k: number | null = null;
  for (const el of keys) {
    const d = diff[el] ?? 0;
    const u = delta[el] ?? 0;
    if (u === 0) {
      if (d !== 0) return null;
      continue;
    }
    if (d % u !== 0) return null;
    const q = d / u;
    if (k === null) k = q;
    else if (k !== q) return null;
  }
  return k && Number.isInteger(k) ? k : null;
}

export function explainImbalance(diff: Record<string, number>): string | null {
  const keys = Object.keys(diff);
  // oxygen only: H2O and O2 cannot be told apart from the element difference alone
  if (keys.length === 1 && keys[0] === "O") {
    const n = diff.O!;
    return n > 0
      ? `не сходится только кислород: в субстратах на ${n} атом(а) O больше — в продуктах, вероятно, не указаны H₂O/O₂, либо неверен коэффициент`
      : `не сходится только кислород: в продуктах на ${-n} атом(а) O больше — в субстратах, вероятно, не указаны H₂O/O₂, либо неверен коэффициент`;
  }
  for (const s of MISSING_SPECIES) {
    const k = multipleOf(diff, s.delta);
    if (k === null) continue;
    const n = Math.abs(k);
    return k > 0
      ? `расхождение равно ${n} × ${s.label}: со стороны продуктов, вероятно, не указан ${s.label} (или его избыток в субстратах)`
      : `расхождение равно ${n} × ${s.label}: со стороны субстратов, вероятно, не указан ${s.label} (или его избыток в продуктах)`;
  }
  return null;
}

const LUMPED = new Set(["black-box", "omitted", "uncertain"]);
const NON_CATALYTIC = new Set(["binding", "dissociation", "black-box", "omitted", "uncertain"]);
const NON_EC_ACTIVITY = /transporter|channel|carrier|binding|antiporter|symporter|uniporter|signaling|receptor|scaffold|structural/i;

/**
 * Pairs of related GO cellular components (part-of / is-a within one organelle). A participant in
 * the related compartment of the one listed for the event is a representation detail, not a
 * conflict. Curated from the GO cellular component ontology.
 */
const RELATED_COMPARTMENTS: [string, string][] = [
  ["GO:0005829", "GO:0005737"], // cytosol – cytoplasm
  ["GO:0005788", "GO:0005790"], // ER lumen – smooth ER
  ["GO:0005789", "GO:0005790"], // ER membrane – smooth ER
  ["GO:0005759", "GO:0005739"], // mitochondrial matrix – mitochondrion
  ["GO:0005743", "GO:0005739"], // inner membrane – mitochondrion
  ["GO:0005758", "GO:0005739"], // intermembrane space – mitochondrion
  // a membrane and the compartments it bounds (membrane-embedded substrates, peripheral enzymes)
  ["GO:0005759", "GO:0005743"], // matrix – inner membrane
  ["GO:0005758", "GO:0005743"], // intermembrane space – inner membrane
  ["GO:0005758", "GO:0005741"], // intermembrane space – outer membrane
  ["GO:0005829", "GO:0005741"], // cytosol – outer membrane
  ["GO:0005829", "GO:0005886"], // cytosol – plasma membrane
  ["GO:0005576", "GO:0005886"], // extracellular region – plasma membrane
  ["GO:0005829", "GO:0005789"], // cytosol – ER membrane
  ["GO:0005788", "GO:0005789"], // ER lumen – ER membrane
  ["GO:0005782", "GO:0005778"], // peroxisomal matrix – peroxisomal membrane
  ["GO:0005829", "GO:0005778"], // cytosol – peroxisomal membrane
  ["GO:0043202", "GO:0005765"], // lysosomal lumen – lysosomal membrane
  ["GO:0005796", "GO:0000139"], // Golgi lumen – Golgi membrane
];
const related = (a: string, b: string) => RELATED_COMPARTMENTS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

function equation(r: Reaction, mets: ReadonlyMap<string, Metabolite>): string {
  const side = (ps: Reaction["inputs"]) =>
    ps
      .map((p) => {
        const m = mets.get(p.metaboliteId);
        return `${p.stoichiometry !== 1 ? `${p.stoichiometry} ` : ""}${m?.abbreviation ?? m?.name ?? p.metaboliteId}`;
      })
      .join(" + ");
  return `${side(r.inputs)} → ${side(r.outputs)}`;
}

export function reviewDataset(ds: Dataset, verification?: SourceVerification | null, decisions: ManualDecision[] = []): ReviewItem[] {
  const mets = new Map(ds.metabolites.map((m) => [m.id, m]));
  const compName = new Map(ds.compartments.map((c) => [c.id, c.name]));
  const verified = new Map((verification?.reactions ?? []).map((v) => [v.id, v]));
  const useVerification = !!verification && verification.datasetGeneratedAt === ds.meta.generatedAt;
  const items: ReviewItem[] = [];
  const url = (id: string) => `https://reactome.org/content/detail/${id}`;

  /** source-check prefix + status for a reaction-level finding */
  const base = (r: Reaction, field: keyof NonNullable<SourceVerificationEntry["matches"]> | "all") => {
    const v = useVerification ? verified.get(r.id) : undefined;
    if (!v || !v.found || !v.matches) return { status: "unreviewed" as ReviewStatus, matches: null as boolean | null };
    const ok = field === "all" ? Object.values(v.matches).every(Boolean) : v.matches[field];
    return { status: (ok ? "checked" : "confirmed-error") as ReviewStatus, matches: ok };
  };
  const importMismatch = "данные базы расходятся с записью Reactome — ошибка импорта";

  for (const r of ds.reactions) {
    const participants = [...r.inputs, ...r.outputs].map((p) => mets.get(p.metaboliteId)).filter((m) => m !== undefined);
    const formulas = Object.fromEntries(participants.map((m) => [m.abbreviation ?? m.name, m.formula ?? null]));

    // --- element balance
    const bal = elementBalance(r, mets);
    if (bal.status === "unbalanced") {
      const b = base(r, "all");
      let status = b.status;
      let explanation: string;
      let needsExpert = true;
      if (b.matches === false) explanation = importMismatch;
      else if (LUMPED.has(r.category)) {
        status = b.matches ? "accepted-exception" : status;
        needsExpert = false;
        explanation = "суммарное событие Reactome: промежуточные участники не перечислены, баланс не ожидается";
      } else {
        const hint = explainImbalance(bal.difference);
        explanation = `${b.matches ? "запись совпадает с Reactome; " : ""}${hint ?? "простого объяснения нет (возможны неточные формулы, обобщённые участники или неполная запись)"}`;
      }
      items.push({
        category: "rxn-unbalanced",
        recordId: r.id,
        severity: "warning",
        status,
        needsExpert,
        explanation,
        basis: b.matches === null ? "rule" : "source-check",
        sourceUrl: url(r.id),
        data: { equation: equation(r, mets), formulas, difference: bal.difference, note: "разность субстраты − продукты, H не учитывается" },
      });
    }

    // --- compartments
    const outside = compartmentMismatch(r, mets);
    if (outside.length) {
      const b = base(r, "compartments");
      const membrane = r.compartmentIds.some((c) => /membrane/.test(compName.get(c) ?? ""));
      const rel = outside.every((o) => r.compartmentIds.some((c) => related(c, o)));
      const outsideMets = participants.filter((m) => outside.includes(m.compartmentId));
      const macro = outsideMets.every((m) => m.kind !== "small-molecule");
      let status: ReviewStatus = b.status;
      let needsExpert = false;
      let explanation: string;
      if (b.matches === false) {
        explanation = importMismatch;
        needsExpert = true;
      } else if (r.isTransport) {
        status = b.matches ? "accepted-exception" : status;
        explanation = "транспорт: у события указан компартмент переноса (обычно мембрана), участники — по обе стороны";
      } else if (membrane) {
        status = b.matches ? "accepted-exception" : status;
        explanation = "событие на мембране: Reactome указывает мембрану, участники находятся в прилегающих компартментах";
      } else if (rel) {
        status = b.matches ? "accepted-exception" : status;
        explanation = "родственные или прилегающие компартменты (часть органеллы, мембрана и ограничиваемое ею пространство)";
      } else if (macro) {
        explanation = "вне компартмента события находятся белки, комплексы или полимеры (связывание, экспрессия, деградация на поверхности)";
      } else {
        needsExpert = true;
        explanation = "малая молекула вне компартментов события и без транспорта — требуется интерпретация";
      }
      items.push({
        category: "rxn-compartment-mismatch",
        recordId: r.id,
        severity: "warning",
        status,
        needsExpert,
        explanation: `${b.matches ? "совпадает с Reactome; " : ""}${explanation}`,
        basis: b.matches === null ? "rule" : "source-check",
        sourceUrl: url(r.id),
        data: {
          reactionCompartments: r.compartmentIds.map((c) => compName.get(c) ?? c),
          outside: outside.map((c) => compName.get(c) ?? c),
          participantsOutside: outsideMets.map((m) => `${m.name} [${compName.get(m.compartmentId) ?? m.compartmentId}]`),
        },
      });
    }

    // --- catalyst
    if (r.enzymeIds.length === 0) {
      const b = base(r, "catalystCount");
      const nonCatalytic = r.isTransport || NON_CATALYTIC.has(r.category);
      items.push({
        category: "rxn-no-catalyst",
        recordId: r.id,
        severity: "info",
        status: b.matches === false ? "confirmed-error" : b.matches && nonCatalytic ? "accepted-exception" : b.status,
        needsExpert: false,
        explanation:
          b.matches === false
            ? importMismatch
            : `${b.matches ? "в Reactome катализатор не указан; " : ""}${
                nonCatalytic ? "транспорт, связывание или суммарное событие — катализатор не обязателен" : "спонтанная реакция или катализатор неизвестен источнику"
              }`,
        basis: b.matches === null ? "rule" : "source-check",
        sourceUrl: url(r.id),
        data: { category: r.category, transport: r.isTransport },
      });
    } else if (r.ecNumbers.length === 0) {
      const b = base(r, "ecNumbers");
      const activities = (r.catalysis ?? []).map((c) => c.activity).filter(Boolean) as string[];
      const nonEc = activities.length > 0 && activities.every((a) => NON_EC_ACTIVITY.test(a));
      items.push({
        category: "rxn-no-ec",
        recordId: r.id,
        severity: "info",
        status: b.matches === false ? "confirmed-error" : b.matches && nonEc ? "accepted-exception" : b.status,
        needsExpert: false,
        explanation:
          b.matches === false
            ? importMismatch
            : `${b.matches ? "в Reactome у активности нет EC; " : ""}${
                nonEc ? "активность транспорта/связывания — EC-номера для неё не присваиваются" : "EC не указан источником; это не означает ошибку записи"
              }`,
        basis: b.matches === null ? "rule" : "source-check",
        sourceUrl: url(r.id),
        data: { activities },
      });
    }

    // --- same entity on both sides
    const ins = new Set(r.inputs.map((p) => p.metaboliteId));
    const both = r.outputs.filter((p) => ins.has(p.metaboliteId)).map((p) => mets.get(p.metaboliteId));
    if (both.length) {
      const b = base(r, "all");
      const carriers = both.every((m) => m && m.kind !== "small-molecule");
      items.push({
        category: "same-both-sides",
        recordId: r.id,
        severity: "warning",
        status: b.matches === false ? "confirmed-error" : b.matches && carriers ? "accepted-exception" : b.status,
        needsExpert: !carriers,
        explanation:
          b.matches === false
            ? importMismatch
            : carriers
              ? "совпадает с Reactome; белок или комплекс-носитель указан и среди субстратов, и среди продуктов"
              : `${b.matches ? "совпадает с Reactome; " : ""}малая молекула и в субстратах, и в продуктах — проверьте, не описан ли так перенос или катализ`,
        basis: b.matches === null ? "rule" : "source-check",
        sourceUrl: url(r.id),
        data: { entities: both.map((m) => m?.name) },
      });
    }
  }

  // --- duplicate equations with the same catalyst
  const groups = new Map<string, Reaction[]>();
  for (const r of ds.reactions) {
    const key = `${r.inputs.map((p) => `${p.stoichiometry}*${p.metaboliteId}`).sort().join("+")}>${r.outputs
      .map((p) => `${p.stoichiometry}*${p.metaboliteId}`)
      .sort()
      .join("+")}|${[...r.enzymeIds].sort().join(",")}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const pathwaySets = g.map((r) => [...r.pathwayIds].sort().join(","));
    const differentPathways = new Set(pathwaySets).size === g.length;
    for (const r of g)
      items.push({
        category: "dup-equation-same-catalyst",
        recordId: r.id,
        severity: "warning",
        status: differentPathways ? "accepted-exception" : "checked",
        needsExpert: !differentPathways,
        explanation: differentPathways
          ? `отдельные события Reactome (${g.map((x) => x.id).join(", ")}) в разных путях или контекстах; не удаляются`
          : `одинаковые события ${g.map((x) => x.id).join(", ")} в одном пути — возможный дубликат источника`,
        basis: "rule",
        sourceUrl: url(r.id),
        data: { group: g.map((x) => ({ id: x.id, name: x.name, pathways: x.pathwayIds, compartments: x.compartmentIds })) },
      });
  }

  // --- manual decisions override rule results (documented, with reviewer and date)
  for (const d of decisions) {
    const it = items.find((x) => x.category === d.category && x.recordId === d.recordId);
    if (!it) continue;
    it.status = d.status;
    it.needsExpert = d.needsExpert;
    it.suspectedSourceIssue = d.suspectedSourceIssue;
    it.explanation = `${d.explanation} (${d.reviewer}, ${d.date})`;
    it.basis = "manual";
  }
  return items;
}

export function summarizeReview(items: ReviewItem[]) {
  const byCategory: Record<string, Record<ReviewStatus | "needsExpert" | "suspectedSourceIssue" | "total", number>> = {};
  for (const it of items) {
    const c = (byCategory[it.category] ??= {
      unreviewed: 0,
      checked: 0,
      "confirmed-error": 0,
      "accepted-exception": 0,
      needsExpert: 0,
      suspectedSourceIssue: 0,
      total: 0,
    });
    c[it.status]++;
    c.total++;
    if (it.needsExpert) c.needsExpert++;
    if (it.suspectedSourceIssue) c.suspectedSourceIssue++;
  }
  return byCategory;
}

/** exposed for tests */
export const _internal = { multipleOf, parseFormula };
