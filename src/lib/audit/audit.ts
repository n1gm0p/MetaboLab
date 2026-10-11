// Data-quality audit of a MetaboMap dataset.
// The audit only REPORTS problems; it never changes scientific data.
// Only type imports here, so the module also runs under `node --experimental-strip-types`.
import type { Dataset, Metabolite, Reaction } from "../model/types";

export type Severity = "error" | "warning" | "info";

export interface AuditCategory {
  id: string;
  severity: Severity;
  title: string;
  /** what the finding means and how it can be resolved */
  suggestion: string;
  count: number;
  /** a few affected records with details, for reading */
  examples: string[];
  /** every affected record id (reaction, metabolite, enzyme or pathway id) */
  recordIds: string[];
}

export interface AuditReport {
  auditedAt: string;
  datasetGeneratedAt: string;
  sourceRelease?: string;
  status: "passed" | "passed-with-warnings" | "failed";
  totals: { reactions: number; metabolites: number; enzymes: number; pathways: number };
  categories: AuditCategory[];
}

const MAX_EXAMPLES = 25;

/** Chemical element symbols (IUPAC). Anything else in a formula (R, X, A, n...) is a generic placeholder. */
const ELEMENTS = new Set(
  "H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu".split(" "),
);

/** Count atoms in a Hill formula. Returns null for generic formulas (R, X, n, parentheses...). */
export function parseFormula(formula: string | undefined): Record<string, number> | null {
  if (!formula || !/^([A-Z][a-z]?\d*)+$/.test(formula)) return null;
  const out: Record<string, number> = {};
  for (const [, el, n] of formula.matchAll(/([A-Z][a-z]?)(\d*)/g)) {
    if (!el) continue;
    if (!ELEMENTS.has(el)) return null;
    out[el] = (out[el] ?? 0) + (n ? Number(n) : 1);
  }
  return out;
}

export type BalanceResult =
  | { status: "balanced" }
  | { status: "unbalanced"; difference: Record<string, number> }
  | { status: "not-checkable"; reason: string };

/**
 * Element balance of a reaction from participant formulas and stoichiometry.
 * Hydrogen is excluded: Reactome uses charged major microspecies, so H (and charge) are often
 * balanced only implicitly by H+/water and are not a reliable signal.
 */
export function elementBalance(reaction: Reaction, metabolites: ReadonlyMap<string, Metabolite>): BalanceResult {
  const total: Record<string, number> = {};
  const sides: [Reaction["inputs"], number][] = [
    [reaction.inputs, 1],
    [reaction.outputs, -1],
  ];
  for (const [parts, sign] of sides) {
    for (const p of parts) {
      const m = metabolites.get(p.metaboliteId);
      if (!m) return { status: "not-checkable", reason: "участник отсутствует в базе" };
      if (m.kind !== "small-molecule") return { status: "not-checkable", reason: "есть белки, комплексы или группы веществ" };
      const f = parseFormula(m.formula);
      if (!f) return { status: "not-checkable", reason: m.formula ? "обобщённая формула (R-группы)" : "нет формулы" };
      for (const [el, n] of Object.entries(f)) total[el] = (total[el] ?? 0) + sign * n * p.stoichiometry;
    }
  }
  const difference = Object.fromEntries(Object.entries(total).filter(([el, v]) => el !== "H" && v !== 0));
  return Object.keys(difference).length ? { status: "unbalanced", difference } : { status: "balanced" };
}

/** Main (non-currency) participant ids, sorted — used to compare reactions. */
function mainSignature(parts: Reaction["inputs"], metabolites: ReadonlyMap<string, Metabolite>): string {
  return parts
    .filter((p) => !metabolites.get(p.metaboliteId)?.currency)
    .map((p) => p.metaboliteId)
    .sort()
    .join("+");
}

/** Participants whose compartment is not listed among the reaction's compartments. */
export function compartmentMismatch(reaction: Reaction, metabolites: ReadonlyMap<string, Metabolite>): string[] {
  const listed = new Set(reaction.compartmentIds);
  const out = new Set<string>();
  for (const p of [...reaction.inputs, ...reaction.outputs]) {
    const c = metabolites.get(p.metaboliteId)?.compartmentId;
    if (c && !listed.has(c)) out.add(c);
  }
  return [...out];
}

export function auditDataset(ds: Dataset, now = new Date()): AuditReport {
  const categories = new Map<string, AuditCategory>();
  const add = (id: string, severity: Severity, title: string, suggestion: string, example?: string) => {
    let c = categories.get(id);
    if (!c) categories.set(id, (c = { id, severity, title, suggestion, count: 0, examples: [], recordIds: [] }));
    c.count++;
    if (example && c.examples.length < MAX_EXAMPLES) c.examples.push(example);
    const rid = example?.match(/^(?:metabolite |reaction |enzyme |pathway )?(\S+)/)?.[1];
    if (rid) c.recordIds.push(rid);
  };

  const mets = new Map(ds.metabolites.map((m) => [m.id, m]));
  const rxns = new Map(ds.reactions.map((r) => [r.id, r]));
  const enz = new Set(ds.enzymes.map((e) => e.id));
  const pws = new Set(ds.pathways.map((p) => p.id));
  const comps = new Set(ds.compartments.map((c) => c.id));

  // --- duplicate ids within one record type (the same Reactome entity may legitimately be both a
  //     reaction participant and a catalyst, so ids are only required to be unique per type)
  for (const [label, list] of [
    ["metabolite", ds.metabolites],
    ["reaction", ds.reactions],
    ["enzyme", ds.enzymes],
    ["pathway", ds.pathways],
  ] as const) {
    const seen = new Set<string>();
    for (const x of list) {
      if (seen.has(x.id)) add("duplicate-id", "error", "Повторяющиеся идентификаторы", "Каждая запись типа должна иметь уникальный id; проверьте импорт.", `${label} ${x.id}`);
      seen.add(x.id);
    }
  }

  // --- metabolites
  for (const m of ds.metabolites) {
    if (!comps.has(m.compartmentId))
      add("dangling-compartment", "error", "Ссылка на несуществующий компартмент", "Добавьте компартмент в базу или исправьте импорт.", m.id);
    if (m.sources.length === 0) add("no-source", "error", "Запись без источника", "У каждой записи должен быть источник.", m.id);
    if (m.kind === "small-molecule" && !m.chebiId)
      add("met-no-chebi", "warning", "Малая молекула без ChEBI", "Источник не привязал вещество к ChEBI; идентичность вещества не подтверждена.", m.id);
    if (m.chebiId && !/^CHEBI:\d+$/.test(m.chebiId))
      add("bad-chebi", "error", "Некорректный формат ChEBI id", "Ожидается CHEBI:<число>.", m.id);
    if (m.kind === "small-molecule" && !m.formula)
      add("met-no-formula", "info", "Малая молекула без формулы", "Формула в источнике отсутствует; показывается как неизвестная.", m.id);
    if (m.formula && !parseFormula(m.formula))
      add("met-generic-formula", "info", "Обобщённая формула (R-группы, полимеры)", "Баланс элементов для таких веществ не проверяется.", m.id);
    if (/\[[^\]]+\]\s*$/.test(m.name))
      add("name-has-compartment", "warning", "Название содержит компартмент", "Компартмент хранится отдельно; суффикс в названии — ошибка нормализации.", m.id);
  }

  // --- reactions
  const sigGroups = new Map<string, Reaction[]>();
  for (const r of ds.reactions) {
    if (!/^R-[A-Z]{3}-\d+$/.test(r.id)) add("bad-reaction-id", "warning", "Нестандартный id реакции", "Ожидается стабильный идентификатор Reactome.", r.id);
    if (r.sources.length === 0) add("no-source", "error", "Запись без источника", "У каждой записи должен быть источник.", r.id);
    if (r.inputs.length === 0 || r.outputs.length === 0)
      add("rxn-empty-side", "error", "Реакция без субстратов или продуктов", "Проверьте событие в источнике.", r.id);
    for (const p of [...r.inputs, ...r.outputs]) {
      if (!mets.has(p.metaboliteId)) add("dangling-participant", "error", "Участник отсутствует в базе", "Исправьте импорт участников.", `${r.id} → ${p.metaboliteId}`);
      if (!Number.isInteger(p.stoichiometry) || p.stoichiometry <= 0)
        add("bad-stoichiometry", "error", "Некорректный стехиометрический коэффициент", "Коэффициент должен быть целым положительным.", r.id);
    }
    const ins = new Set(r.inputs.map((p) => p.metaboliteId));
    if (r.outputs.some((p) => ins.has(p.metaboliteId)))
      add("same-both-sides", "warning", "Одна и та же сущность в субстратах и продуктах", "Обычно это катализатор или носитель, указанный как участник; проверьте событие в источнике.", r.id);
    for (const e of r.enzymeIds) if (!enz.has(e)) add("dangling-enzyme", "error", "Ссылка на отсутствующий фермент", "Исправьте импорт.", r.id);
    for (const p of r.pathwayIds) if (!pws.has(p)) add("dangling-pathway", "error", "Ссылка на отсутствующий путь", "Исправьте импорт.", r.id);
    if (r.enzymeIds.length === 0)
      add("rxn-no-catalyst", "info", "Катализатор не указан", "Спонтанная реакция или сведения отсутствуют в источнике; в карточке показывается «не указан».", r.id);
    else if (r.ecNumbers.length === 0)
      add("rxn-no-ec", "info", "Катализатор без EC-номера", "Источник не указал EC для каталитической активности.", r.id);
    if (r.compartmentIds.length === 0) add("rxn-no-compartment", "warning", "Реакция без компартмента", "Уточните локализацию в источнике.", r.id);
    const mismatch = compartmentMismatch(r, mets);
    if (mismatch.length)
      add("rxn-compartment-mismatch", "warning", "Компартмент участника не указан у реакции", "Обычно это мембранные/транспортные события; в карточке показываются компартменты участников.", r.id);
    const bal = elementBalance(r, mets);
    if (bal.status === "unbalanced")
      add("rxn-unbalanced", "warning", "Баланс элементов не сходится (без учёта H)", "Сверьте формулы участников с ChEBI и событие в источнике; возможна неполная запись реакции.", `${r.id} ${JSON.stringify(bal.difference)}`);
    else if (bal.status === "not-checkable") add("rxn-balance-unchecked", "info", "Баланс элементов не проверяется", "Есть белки, группы веществ или обобщённые формулы.", r.id);
    if (r.category === "black-box" || r.category === "omitted" || r.category === "uncertain")
      add("rxn-lumped", "info", "Суммарное событие (несколько стадий в одной записи)", "Используйте с осторожностью в маршрутах: промежуточные стадии не показаны.", r.id);

    // reverse links
    if (r.reverseReactionId) {
      const other = rxns.get(r.reverseReactionId);
      if (!other) add("reverse-dangling", "error", "Обратная реакция отсутствует в базе", "Удалите ссылку или импортируйте реакцию.", r.id);
      else {
        if (other.reverseReactionId !== r.id)
          add("reverse-asymmetric", "warning", "Несимметричная ссылка на обратную реакцию", "Ссылки на обратную реакцию должны быть взаимными.", r.id);
        const swapped =
          mainSignature(r.inputs, mets) === mainSignature(other.outputs, mets) &&
          mainSignature(r.outputs, mets) === mainSignature(other.inputs, mets);
        if (!swapped)
          add("reverse-not-mirror", "warning", "Обратная реакция не зеркальна по основным участникам", "Ссылка из источника связывает реакции с разными участниками; проверьте вручную.", `${r.id} ↔ ${other.id}`);
      }
    }
    const key = `${r.inputs.map((p) => `${p.stoichiometry}*${p.metaboliteId}`).sort().join("+")}>${r.outputs.map((p) => `${p.stoichiometry}*${p.metaboliteId}`).sort().join("+")}`;
    const g = sigGroups.get(key);
    if (g) g.push(r);
    else sigGroups.set(key, [r]);
  }
  for (const group of sigGroups.values()) {
    if (group.length < 2) continue;
    const catalysts = group.map((r) => r.enzymeIds.slice().sort().join(","));
    const sameCatalyst = new Set(catalysts).size < catalysts.length;
    if (sameCatalyst)
      add("dup-equation-same-catalyst", "warning", "Одинаковое уравнение и катализатор у нескольких реакций", "Возможный дубликат; сравните события в источнике.", group.map((r) => r.id).join(" = "));
    else
      add("dup-equation-isoenzymes", "info", "Одинаковое уравнение, разные катализаторы (изоферменты)", "Не ошибка: источник описывает реакции разных изоферментов отдельно.", group.map((r) => r.id).join(" = "));
  }

  // --- enzymes & pathways
  for (const e of ds.enzymes) {
    if (e.sources.length === 0) add("no-source", "error", "Запись без источника", "У каждой записи должен быть источник.", e.id);
    for (const ec of e.ecNumbers) {
      if (/^\d+(\.\d+){0,2}$/.test(ec))
        add("ec-partial", "info", "Неполный EC-номер (класс или подкласс)", "Источник указывает только уровень класса активности; полный номер неизвестен.", `${e.id} ${ec}`);
      else if (!/^\d+\.\d+\.\d+\.(\d+|n\d+|-)$/.test(ec)) add("bad-ec", "warning", "Некорректный формат EC", "Ожидается вид 1.2.3.4.", `${e.id} ${ec}`);
    }
    if (e.genes.length === 0) add("enzyme-no-genes", "info", "Катализатор без генов", "Состав катализатора не раскрыт в источнике.", e.id);
    for (const r of e.reactionIds) if (!rxns.has(r)) add("dangling-reaction", "error", "Ссылка на отсутствующую реакцию", "Исправьте импорт.", e.id);
  }
  for (const p of ds.pathways) {
    for (const r of p.reactionIds) if (!rxns.has(r)) add("dangling-reaction", "error", "Ссылка на отсутствующую реакцию", "Исправьте импорт.", p.id);
    for (const s of p.subpathwayIds) if (!pws.has(s)) add("dangling-pathway", "error", "Ссылка на отсутствующий путь", "Исправьте импорт.", p.id);
  }

  const list = [...categories.values()].sort(
    (a, b) => ["error", "warning", "info"].indexOf(a.severity) - ["error", "warning", "info"].indexOf(b.severity) || b.count - a.count,
  );
  const hasErrors = list.some((c) => c.severity === "error");
  const hasWarnings = list.some((c) => c.severity === "warning");
  return {
    auditedAt: now.toISOString(),
    datasetGeneratedAt: ds.meta.generatedAt,
    sourceRelease: ds.meta.importer?.reactomeRelease,
    status: hasErrors ? "failed" : hasWarnings ? "passed-with-warnings" : "passed",
    totals: { reactions: ds.reactions.length, metabolites: ds.metabolites.length, enzymes: ds.enzymes.length, pathways: ds.pathways.length },
    categories: list,
  };
}
