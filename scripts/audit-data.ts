// Data-quality audit: validates public/data/dataset.json and writes
//   public/data/audit.json        machine-readable summary (shown in the app)
//   data-review/review.json       every finding with status, explanation, source link and data
//   docs/data-audit.md            human-readable report for manual review
// Optional inputs (used when present and matching the dataset version):
//   data-review/source-verification.json  re-check against Reactome (scripts/audit/verify-source.mjs)
//   data-review/decisions.json            documented manual decisions
// The audit never modifies the dataset.
// Run: npm run audit:data   (Node >= 22.6, uses --experimental-strip-types)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { auditDataset, type AuditReport } from "../src/lib/audit/audit.ts";
import {
  REVIEW_STATUS_LABEL,
  reviewDataset,
  summarizeReview,
  type ManualDecision,
  type ReviewItem,
  type SourceVerification,
} from "../src/lib/audit/review.ts";
import { checkIntegrity, datasetSchema } from "../src/lib/model/schema.ts";

const root = new URL("../", import.meta.url);
const readJson = <T,>(rel: string): T | null => {
  const u = new URL(rel, root);
  return existsSync(u) ? (JSON.parse(readFileSync(u, "utf8")) as T) : null;
};

const parsed = datasetSchema.safeParse(readJson("public/data/dataset.json"));
if (!parsed.success) {
  console.error("dataset.json does not match the schema:");
  for (const issue of parsed.error.issues.slice(0, 20)) console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}
const ds = parsed.data;
const integrity = checkIntegrity(ds);
const report: AuditReport & { review?: unknown } = auditDataset(ds);
if (integrity.length) report.status = "failed";

const verification = readJson<SourceVerification>("data-review/source-verification.json");
const decisions = readJson<ManualDecision[]>("data-review/decisions.json") ?? [];
const verificationUsable = !!verification && verification.datasetGeneratedAt === ds.meta.generatedAt;
if (verification && !verificationUsable)
  console.warn("source-verification.json belongs to another dataset version: run `node scripts/audit/verify-source.mjs`");
const items = reviewDataset(ds, verificationUsable ? verification : null, decisions);
const summary = summarizeReview(items);
report.review = {
  sourceVerifiedAt: verificationUsable ? verification!.verifiedAt : null,
  manualDecisions: decisions.length,
  byCategory: summary,
};

mkdirSync(new URL("data-review/", root), { recursive: true });
writeFileSync(new URL("public/data/audit.json", root), JSON.stringify(report, null, 1));
writeFileSync(new URL("data-review/review.json", root), JSON.stringify({ auditedAt: report.auditedAt, items }, null, 1));

// ---------------------------------------------------------------- markdown report
const sev = { error: "Ошибка", warning: "Предупреждение", info: "Сведения" } as const;
const esc = (s: unknown) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const catTitle = new Map(report.categories.map((c) => [c.id, c.title]));
const statusCell = (it: ReviewItem) =>
  `${REVIEW_STATUS_LABEL[it.status]}${it.needsExpert ? " · **нужна экспертиза**" : ""}${it.suspectedSourceIssue ? " · вероятная ошибка источника" : ""}`;

const lines: string[] = [
  "# Аудит качества данных MetaboMap",
  "",
  `- Проверено: ${report.auditedAt}`,
  `- База сгенерирована: ${report.datasetGeneratedAt}`,
  `- Релиз Reactome: ${report.sourceRelease ?? "—"}`,
  `- Сверка с Reactome: ${verificationUsable ? verification!.verifiedAt : "не выполнялась для этой версии базы"}`,
  `- Ручных решений: ${decisions.length}`,
  `- Статус: **${report.status}**`,
  "",
  "Аудит только сообщает о проблемах; научные данные автоматически не изменяются. Объяснения с основанием «правило» —",
  "автоматические гипотезы, а не экспертное заключение.",
  "",
  "## Сводка",
  "",
  "| Уровень | Проверка | Кол-во | Что делать |",
  "|---|---|---:|---|",
  ...report.categories.map((c) => `| ${sev[c.severity]} | ${c.title} | ${c.count} | ${c.suggestion} |`),
  "",
  "## Статусы разбора",
  "",
  "| Проверка | Всего | Не проверено | Проверено | Подтв. ошибка | Допустимое исключение | Нужна экспертиза | Вероятная ошибка источника |",
  "|---|---:|---:|---:|---:|---:|---:|---:|",
  ...Object.entries(summary).map(
    ([cat, s]) =>
      `| ${catTitle.get(cat) ?? cat} | ${s.total} | ${s.unreviewed} | ${s.checked} | ${s["confirmed-error"]} | ${s["accepted-exception"]} | ${s.needsExpert} | ${s.suspectedSourceIssue} |`,
  ),
  "",
];

const section = (cat: string, columns: string[], row: (it: ReviewItem) => string[]) => {
  const list = items.filter((i) => i.category === cat);
  if (!list.length) return;
  lines.push(`## ${catTitle.get(cat) ?? cat} (${list.length})`, "", `| ${columns.join(" | ")} |`, `|${columns.map(() => "---").join("|")}|`);
  for (const it of list) lines.push(`| ${row(it).map(esc).join(" | ")} |`);
  lines.push("");
};
const link = (it: ReviewItem) => `[${it.recordId}](${it.sourceUrl})`;
section("rxn-unbalanced", ["Реакция", "Уравнение", "Формулы", "Разность (без H)", "Статус", "Объяснение"], (it) => [
  link(it),
  it.data?.equation,
  Object.entries((it.data?.formulas as Record<string, string | null>) ?? {})
    .map(([k, v]) => `${k}: ${v ?? "—"}`)
    .join("; "),
  JSON.stringify(it.data?.difference),
  statusCell(it),
  it.explanation,
]);
section("rxn-compartment-mismatch", ["Реакция", "Компартменты события", "Вне их", "Статус", "Объяснение"], (it) => [
  link(it),
  (it.data?.reactionCompartments as string[]).join(", "),
  (it.data?.participantsOutside as string[]).join("; "),
  statusCell(it),
  it.explanation,
]);
section("dup-equation-same-catalyst", ["Реакция", "Статус", "Объяснение"], (it) => [link(it), statusCell(it), it.explanation]);
section("same-both-sides", ["Реакция", "Сущность", "Статус", "Объяснение"], (it) => [link(it), (it.data?.entities as string[]).join(", "), statusCell(it), it.explanation]);
const compact = (cat: string) => {
  const list = items.filter((i) => i.category === cat);
  if (!list.length) return;
  const byExplanation = new Map<string, ReviewItem[]>();
  for (const it of list) byExplanation.set(`${REVIEW_STATUS_LABEL[it.status]} — ${it.explanation}`, [...(byExplanation.get(`${REVIEW_STATUS_LABEL[it.status]} — ${it.explanation}`) ?? []), it]);
  lines.push(`## ${catTitle.get(cat) ?? cat} (${list.length})`, "");
  for (const [k, v] of byExplanation) lines.push(`- **${v.length}** · ${k}: ${v.slice(0, 40).map((i) => i.recordId).join(", ")}${v.length > 40 ? " …" : ""}`);
  lines.push("");
};
compact("rxn-no-catalyst");
compact("rxn-no-ec");

mkdirSync(new URL("docs/", root), { recursive: true });
writeFileSync(new URL("docs/data-audit.md", root), lines.join("\n"));

console.log(`Audit status: ${report.status}`);
for (const c of report.categories) console.log(`  [${c.severity}] ${c.title}: ${c.count}`);
console.log("Review:");
for (const [cat, s] of Object.entries(summary))
  console.log(
    `  ${cat}: total ${s.total}, unreviewed ${s.unreviewed}, checked ${s.checked}, error ${s["confirmed-error"]}, exception ${s["accepted-exception"]}, expert ${s.needsExpert}`,
  );
if (report.status === "failed") process.exit(1);
