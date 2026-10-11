"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { AuditReport } from "@/lib/audit/audit";
import { X } from "lucide-react";
import { useApp } from "@/components/state/app-state";
import { ExtLink } from "@/components/ui/primitives";

export function AboutDataDialog() {
  const { index } = useApp();
  const { meta, reactions, metabolites, enzymes, pathways, compartments } = index.dataset;
  const smallMolecules = metabolites.filter((m) => m.kind === "small-molecule");
  const chemicals = new Set(smallMolecules.map((m) => m.chebiId).filter(Boolean));
  const withRu = metabolites.filter((m) => m.nameRu).length;
  const transport = reactions.filter((r) => r.isTransport).length;
  const withReverse = reactions.filter((r) => r.reversible || r.reverseReactionId).length;
  const [audit, setAudit] = useState<AuditReport | null | "missing">(null);
  const loadAudit = () => {
    if (audit !== null || meta.isMock) return;
    fetch("/data/audit.json", { cache: "no-cache" })
      .then((r) => (r.ok ? (r.json() as Promise<AuditReport>) : Promise.reject(new Error(String(r.status)))))
      .then((a) => setAudit(a))
      .catch(() => setAudit("missing"));
  };
  const statusLabel = { passed: "пройдена", "passed-with-warnings": "пройдена с предупреждениями", failed: "есть ошибки" } as const;

  return (
    <Dialog.Root onOpenChange={(open) => open && loadAudit()}>
      <Dialog.Trigger className="font-medium text-accent hover:underline">О данных и покрытии</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/25 backdrop-blur-[2px]" />
        <Dialog.Content className="glass fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(640px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl p-6 text-[14px] leading-relaxed animate-in scroll-thin">
          <div className="flex items-start justify-between gap-4">
            <Dialog.Title className="text-[20px] font-semibold tracking-tight">{meta.title}</Dialog.Title>
            <Dialog.Close className="grid h-9 w-9 place-items-center rounded-lg hover:bg-hover" aria-label="Закрыть">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="mt-1 text-[13px] text-muted">
            Импорт: {new Date(meta.generatedAt).toLocaleString("ru-RU")}
            {meta.importer && ` · релиз Reactome ${meta.importer.reactomeRelease}${meta.importer.chebi ? " · ChEBI через OLS" : ""}`}
            {meta.isMock && " · демонстрационный набор, проверка не выполнялась"}
          </Dialog.Description>

          {!meta.isMock && (
            <div className="mt-4 rounded-xl border border-line-strong p-3 text-[13px]">
              <div className="font-semibold">Проверка качества данных</div>
              {audit === null && <p className="mt-1 text-muted">Загрузка отчёта…</p>}
              {audit === "missing" && <p className="mt-1 text-warn">Отчёт проверки не найден. Запустите «npm run audit:data».</p>}
              {audit && audit !== "missing" && (
                <>
                  <p className="mt-1 text-ink-2">
                    Статус: <span className={audit.status === "failed" ? "text-warn" : "text-in"}>{statusLabel[audit.status]}</span> · проверено{" "}
                    {new Date(audit.auditedAt).toLocaleString("ru-RU")}
                    {audit.datasetGeneratedAt !== meta.generatedAt && <span className="text-warn"> (отчёт относится к другой версии базы)</span>}
                  </p>
                  <ul className="mt-2 space-y-1">
                    {audit.categories.map((c) => (
                      <li key={c.id} className="flex gap-2 text-[12px]">
                        <span
                          className={
                            c.severity === "error" ? "w-4 shrink-0 text-warn" : c.severity === "warning" ? "w-4 shrink-0 text-out" : "w-4 shrink-0 text-faint"
                          }
                          aria-label={c.severity}
                        >
                          {c.severity === "info" ? "·" : "!"}
                        </span>
                        <span className="flex-1 text-ink-2" title={c.suggestion}>
                          {c.title}
                        </span>
                        <span className="tabular text-muted">{c.count}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[11px] text-faint">
                    Проверка только сообщает о проблемах; данные автоматически не исправляются. Подробный отчёт: docs/data-audit.md.
                  </p>
                </>
              )}
            </div>
          )}

          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[
              ["Реакций", reactions.length],
              ["Участников (по компартментам)", metabolites.length],
              ["Уникальных веществ ChEBI", chemicals.size],
              ["Ферментов (каталитических активностей)", enzymes.length],
              ["Путей и подпутей", pathways.length],
              ["Компартментов", compartments.length],
              ["Транспортных реакций", transport],
              ["С обратным превращением в базе", withReverse],
              ["С русским названием", withRu],
            ].map(([label, n]) => (
              <div key={label} className="rounded-xl bg-hover p-3">
                <div className="tabular text-[20px] font-semibold">{n}</div>
                <div className="text-[11px] leading-snug text-muted">{label}</div>
              </div>
            ))}
          </div>

          <h3 className="mt-6 text-[13px] font-semibold">Покрытие</h3>
          <p className="mt-1 text-ink-2">{meta.coverage.note}</p>

          <h3 className="mt-5 text-[13px] font-semibold">Источники и лицензии</h3>
          <ul className="mt-2 space-y-2">
            {meta.sources.map((s) => (
              <li key={s.name} className="rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <ExtLink href={s.url} className="font-medium">
                    {s.name}
                  </ExtLink>
                  {s.version && <span className="text-[12px] text-muted">версия {s.version}</span>}
                  <span className="text-[12px] text-muted">· {s.license}</span>
                </div>
                <div className="mt-0.5 text-[13px] text-ink-2">{s.usage}</div>
              </li>
            ))}
          </ul>

          <h3 className="mt-5 text-[13px] font-semibold">Как читать данные</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-ink-2">
            <li>Каждое вещество привязано к компартменту: глюкоза в цитозоле и во внеклеточном пространстве — разные узлы, связанные только транспортом.</li>
            <li>Реакция — отдельный узел; вещества соединены только через реакции, в которых участвуют.</li>
            <li>Направление реакции соответствует источнику. Reactome моделирует обратные превращения отдельными реакциями; такие пары связываются (по ссылке Reactome или по совпадению основных участников) и показываются в карточке.</li>
            <li>Описания реакций — тексты Reactome без изменений; определения веществ — ChEBI. Отсутствующие сведения не дополняются.</li>
            <li>Русские названия — курируемый словарь MetaboMap; если перевода нет, показывается международное название.</li>
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
