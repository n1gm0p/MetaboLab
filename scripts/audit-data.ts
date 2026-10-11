// Data-quality audit: validates public/data/dataset.json and writes
//   public/data/audit.json   (machine-readable, shown in the app)
//   docs/data-audit.md       (human-readable report)
// Run: npm run audit:data   (Node >= 22.6, uses --experimental-strip-types)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { auditDataset, type AuditReport } from "../src/lib/audit/audit.ts";
import { checkIntegrity, datasetSchema } from "../src/lib/model/schema.ts";

const root = new URL("../", import.meta.url);
const raw: unknown = JSON.parse(readFileSync(new URL("public/data/dataset.json", root), "utf8"));

const parsed = datasetSchema.safeParse(raw);
if (!parsed.success) {
  console.error("dataset.json does not match the schema:");
  for (const issue of parsed.error.issues.slice(0, 20)) console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}
const integrity = checkIntegrity(parsed.data);
const report: AuditReport = auditDataset(parsed.data);
if (integrity.length) report.status = "failed";

writeFileSync(new URL("public/data/audit.json", root), JSON.stringify(report, null, 1));

const sev = { error: "Ошибка", warning: "Предупреждение", info: "Сведения" } as const;
const lines = [
  "# Аудит качества данных MetaboMap",
  "",
  `- Проверено: ${report.auditedAt}`,
  `- База сгенерирована: ${report.datasetGeneratedAt}`,
  `- Релиз Reactome: ${report.sourceRelease ?? "—"}`,
  `- Статус: **${report.status}**`,
  `- Записей: ${report.totals.reactions} реакций, ${report.totals.metabolites} участников, ${report.totals.enzymes} катализаторов, ${report.totals.pathways} путей`,
  "",
  "Аудит только сообщает о проблемах; научные данные автоматически не изменяются.",
  "",
  "| Уровень | Проверка | Кол-во | Что делать |",
  "|---|---|---:|---|",
  ...report.categories.map((c) => `| ${sev[c.severity]} | ${c.title} | ${c.count} | ${c.suggestion} |`),
  "",
  ...report.categories.flatMap((c) => [`## ${c.title}`, "", ...c.examples.map((e) => `- ${e}`), ""]),
];
mkdirSync(new URL("docs/", root), { recursive: true });
writeFileSync(new URL("docs/data-audit.md", root), lines.join("\n"));

console.log(`Audit status: ${report.status}`);
for (const c of report.categories) console.log(`  [${c.severity}] ${c.title}: ${c.count}`);
if (report.status === "failed") process.exit(1);
