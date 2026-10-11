"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Flag, MapPin, X } from "lucide-react";
import type { Participant } from "@/lib/model/types";
import { compartmentName } from "@/lib/data/metabo-index";
import { useApp } from "@/components/state/app-state";
import { useNavigator } from "@/components/state/use-navigator";
import { useUserData } from "@/components/library/user-data";
import { IconButton, Reveal, TextButton, cx } from "@/components/ui/primitives";

/**
 * Step-by-step study of a pathway. Every question is answered strictly from the reaction record:
 * products of the record, catalysts listed by the source (all isoforms), compartments of the record.
 * A question is skipped when the source has no data for it.
 */
export function PathwayWalkthrough({ pathwayId, reactionIds, onClose }: { pathwayId: string; reactionIds: string[]; onClose: () => void }) {
  const { index, state } = useApp();
  const nav = useNavigator();
  const ud = useUserData();
  const [i, setI] = useState(0);
  const rid = reactionIds[i];
  const r = rid ? index.reactions.get(rid) : undefined;
  if (!r) return null;

  const name = (p: Participant) => {
    const m = index.metabolites.get(p.metaboliteId);
    const n = m ? (state.preferRu && m.nameRu) || m.name : p.metaboliteId;
    return p.stoichiometry !== 1 ? `${p.stoichiometry} ${n}` : n;
  };
  const isMain = (p: Participant) => !index.metabolites.get(p.metaboliteId)?.currency;
  const mainIn = r.inputs.filter(isMain);
  const cofIn = r.inputs.filter((p) => !isMain(p));
  const mainOut = r.outputs.filter(isMain);
  const cofOut = r.outputs.filter((p) => !isMain(p));
  const enzymes = r.enzymeIds.map((e) => index.enzymes.get(e)).filter((e) => e !== undefined);
  const ref = { type: "reaction" as const, id: r.id };
  const difficult = ud.isDifficult(ref);
  const pathwayName = index.pathways.get(pathwayId)?.nameRu ?? index.pathways.get(pathwayId)?.name;

  return (
    <section className="mx-5 mb-4 rounded-2xl border border-accent/40 bg-panel-solid p-4" aria-label="Прохождение пути по шагам">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-accent">Прохождение · {pathwayName}</div>
          <div className="tabular text-[12px] text-muted">
            Шаг {i + 1} из {reactionIds.length}
          </div>
        </div>
        <IconButton label="Закрыть прохождение" size="sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </IconButton>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-hover">
        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${((i + 1) / reactionIds.length) * 100}%` }} />
      </div>

      {/* key resets all revealed answers when the step changes */}
      <div key={r.id} className="mt-3 space-y-3 text-[13px]">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">Субстраты</div>
          <div className="mt-0.5 text-ink">
            {mainIn.map(name).join(" + ") || "—"}
            {cofIn.length > 0 && <span className="text-muted"> + {cofIn.map(name).join(" + ")}</span>}
          </div>
        </div>
        <Question label="Что образуется?">
          {mainOut.map(name).join(" + ") || "—"}
          {cofOut.length > 0 && <span className="text-muted"> + {cofOut.map(name).join(" + ")}</span>}
        </Question>
        {enzymes.length > 0 ? (
          <Question label={enzymes.length > 1 ? "Какие катализаторы указаны в источнике?" : "Какой фермент катализирует?"}>
            {enzymes.map((e) => `${e.nameRu ?? e.name}${e.ecNumbers.length ? ` (EC ${e.ecNumbers.join(", ")})` : ""}`).join("; ")}
          </Question>
        ) : (
          <p className="text-[12px] text-faint">Катализатор в источнике не указан — вопрос о ферменте пропущен.</p>
        )}
        {r.compartmentIds.length > 0 && (
          <Question label="Где протекает?">{r.compartmentIds.map((c) => compartmentName(index, c)).join(", ")}</Question>
        )}
        {r.regulation.length > 0 && (
          <Question label="Как регулируется (по данным источника)?">
            {r.regulation
              .map((g) => `${g.type === "negative" ? "ингибирует" : g.type === "positive" ? "активирует" : "необходим"}: ${g.regulatorName}`)
              .join("; ")}
          </Question>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <TextButton onClick={() => setI((x) => Math.max(0, x - 1))} disabled={i === 0} aria-label="Предыдущий шаг">
          <ChevronLeft className="h-4 w-4" /> Назад
        </TextButton>
        <TextButton tone="primary" onClick={() => setI((x) => Math.min(reactionIds.length - 1, x + 1))} disabled={i === reactionIds.length - 1} aria-label="Следующий шаг">
          Далее <ChevronRight className="h-4 w-4" />
        </TextButton>
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton label="Показать реакцию на карте" onClick={() => nav.open(ref)}>
            <MapPin className="h-4 w-4" />
          </IconButton>
          <IconButton
            label={difficult ? "Снять отметку «сложная»" : "Отметить как сложную"}
            active={difficult}
            onClick={() => ud.toggleDifficult(ref, r.nameRu ?? r.name)}
          >
            <Flag className="h-4 w-4" fill={difficult ? "currentColor" : "none"} />
          </IconButton>
        </div>
      </div>
    </section>
  );
}

function Question({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className={cx("text-[11px] font-semibold uppercase tracking-[0.06em] text-muted")}>{label}</div>
      <div className="mt-1 text-ink">
        <Reveal hidden placeholder="Показать ответ">
          {children}
        </Reveal>
      </div>
    </div>
  );
}
