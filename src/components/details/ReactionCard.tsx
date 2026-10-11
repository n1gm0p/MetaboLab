"use client";

import { ArrowDown, ArrowUpDown, Minus, Plus } from "lucide-react";
import type { Participant } from "@/lib/model/types";
import { ecUrl, prettyFormula, rheaUrl } from "@/lib/format";
import { useApp } from "@/components/state/app-state";
import { useNavigator } from "@/components/state/use-navigator";
import { Chip, ExtLink, Reveal, Section, cx } from "@/components/ui/primitives";
import { CardHeader, CompartmentChip, EntityLink, SourcesSection, SummarySection, useDetails } from "./common";
import { CardActions } from "./CardActions";

const CATEGORY_LABEL: Record<string, string> = {
  transition: "Химическое превращение",
  binding: "Связывание",
  dissociation: "Диссоциация",
  transport: "Транспорт",
  "black-box": "Суммарное событие (black box)",
  polymerisation: "Полимеризация",
  depolymerisation: "Деполимеризация",
  omitted: "Опущенные промежуточные стадии",
  uncertain: "Неопределённый механизм",
};

export function ReactionCard({ id }: { id: string }) {
  const { index, state } = useApp();
  const nav = useNavigator();
  const r = index.reactions.get(id);
  const { details, loading, error } = useDetails(r ? id : undefined);
  if (!r) return <p className="p-5 text-muted">Реакция не найдена.</p>;
  const quiz = state.quizMode;

  const main = (ps: Participant[]) => ps.filter((p) => !index.metabolites.get(p.metaboliteId)?.currency);
  const cof = (ps: Participant[]) => ps.filter((p) => index.metabolites.get(p.metaboliteId)?.currency);
  const enzymes = r.enzymeIds.map((e) => index.enzymes.get(e)).filter((e) => e !== undefined);

  return (
    <div>
      <CardHeader
        kicker={r.isTransport ? "Транспортная реакция" : "Реакция"}
        title={(state.preferRu && r.nameRu) || r.name}
        subtitle={state.preferRu && r.nameRu ? r.name : undefined}
        hideTitle={quiz}
        chips={
          <>
            {r.reversible ? (
              <Chip tone="accent" title="Источник указывает обратную реакцию">
                <ArrowUpDown className="h-3 w-3" /> обратима
              </Chip>
            ) : r.reverseReactionId ? (
              <Chip tone="accent" title="Обратное превращение описано в источнике отдельной реакцией (ссылка ниже)">
                <ArrowUpDown className="h-3 w-3" /> обратное превращение — отдельная реакция
              </Chip>
            ) : (
              <Chip title="Направление, указанное источником. Обратная реакция в базе не найдена.">
                <ArrowDown className="h-3 w-3" /> направленная
              </Chip>
            )}
            {r.compartmentIds.map((c) => (
              <CompartmentChip key={c} id={c} />
            ))}
            <Chip>{CATEGORY_LABEL[r.category] ?? r.category}</Chip>
          </>
        }
      />
      <CardActions refTo={{ type: "reaction", id }} />

      <Section title="Уравнение">
        <div className="rounded-xl border border-line bg-panel-solid/50 p-3">
          <EquationSide parts={r.inputs} label="Субстраты" showCompartments={r.isTransport || r.compartmentIds.length > 1} />
          <div className="my-2 flex items-center gap-2 text-[12px] text-muted">
            <div className="h-px flex-1 bg-line" />
            <span className="text-[18px] leading-none text-ink-2">{r.reversible ? "⇄" : "→"}</span>
            <div className="h-px flex-1 bg-line" />
          </div>
          <EquationSide parts={r.outputs} label="Продукты" showCompartments={r.isTransport || r.compartmentIds.length > 1} />
        </div>
        {(cof(r.inputs).length > 0 || cof(r.outputs).length > 0) && (
          <p className="mt-2 text-[12px] text-muted">
            Основные участники: {main(r.inputs).length} → {main(r.outputs).length}; кофакторы и «валютные» молекулы выделены серым.
          </p>
        )}
        {r.reverseReactionId && index.reactions.has(r.reverseReactionId) && (
          <p className="mt-2 text-[13px]">
            Обратное превращение: <EntityLink refTo={{ type: "reaction", id: r.reverseReactionId }} hideInQuiz />
          </p>
        )}
      </Section>

      <Section title="Фермент" count={enzymes.length}>
        {enzymes.length === 0 ? (
          <p className="text-[13px] text-muted">Катализатор в источнике не указан.</p>
        ) : (
          <ul className="space-y-2">
            {enzymes.map((e) => (
              <li key={e.id} className="rounded-xl bg-hover p-3">
                <Reveal hidden={quiz} placeholder="Показать фермент">
                  <button type="button" onClick={() => nav.open({ type: "enzyme", id: e.id })} className="text-left text-[14px] font-medium hover:text-accent">
                    {e.nameRu ?? e.name}
                  </button>
                  {e.genes.length > 0 && <div className="mt-0.5 text-[12px] text-muted">Гены: {e.genes.join(", ")}</div>}
                  {e.activity && (
                    <div className="mt-0.5 text-[12px] text-muted">
                      Активность (GO): {e.activity}
                      {e.activityRu && ` — ${e.activityRu}`}
                    </div>
                  )}
                  {e.cofactorIds.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[12px]">
                      <span className="text-muted">Кофакторы в составе:</span>
                      {e.cofactorIds.map((c) => (
                        <Chip key={c}>{index.metabolites.get(c)?.nameRu ?? index.metabolites.get(c)?.name ?? c}</Chip>
                      ))}
                    </div>
                  )}
                </Reveal>
              </li>
            ))}
          </ul>
        )}
        {r.ecNumbers.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2 text-[13px]">
            {r.ecNumbers.map((ec) => (
              <Reveal key={ec} hidden={quiz} placeholder="EC ?">
                <ExtLink href={ecUrl(ec)}>EC {ec}</ExtLink>
              </Reveal>
            ))}
          </div>
        )}
      </Section>

      <Section title="Регуляция" count={r.regulation.length}>
        {r.regulation.length === 0 ? (
          <p className="text-[13px] text-muted">В источнике для этой реакции регуляция не описана.</p>
        ) : (
          <ul className="space-y-1.5">
            {r.regulation.map((g, i) => (
              <li key={`${g.regulatorName}-${i}`} className="flex items-start gap-2 text-[13px]">
                <span
                  className={cx(
                    "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full",
                    g.type === "negative" ? "bg-out-soft text-out" : "bg-in-soft text-in",
                  )}
                >
                  {g.type === "negative" ? <Minus className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                </span>
                <span>
                  <span className="text-muted">
                    {g.type === "negative" ? "Ингибирование: " : g.type === "positive" ? "Активация: " : "Необходимое условие: "}
                  </span>
                  {g.regulatorId && index.metabolites.has(g.regulatorId) ? (
                    <EntityLink refTo={{ type: "metabolite", id: g.regulatorId }} hideInQuiz />
                  ) : (
                    <Reveal hidden={quiz} placeholder="?">
                      <span className="font-medium">{g.regulatorName}</span>
                    </Reveal>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {r.pathwayIds.length > 0 && (
        <Section title="Входит в пути" count={r.pathwayIds.length}>
          <ul className="flex flex-wrap gap-1.5">
            {r.pathwayIds.map((p) => (
              <li key={p}>
                <button
                  type="button"
                  onClick={() => nav.openPathway(p)}
                  className="min-h-8 rounded-full border border-line px-3 text-[12px] text-ink-2 hover:border-accent hover:text-accent"
                >
                  {nav.nameOf({ type: "pathway", id: p })}
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <SummarySection details={details} loading={loading} error={error} title="Описание (Reactome)" />

      {r.rheaIds.length > 0 && (
        <Section title="Перекрёстные ссылки">
          <div className="flex flex-wrap gap-3 text-[13px]">
            {r.rheaIds.map((x) => (
              <ExtLink key={x} href={rheaUrl(x)}>
                RHEA:{x}
              </ExtLink>
            ))}
          </div>
        </Section>
      )}

      <SourcesSection sources={r.sources} details={details} />
    </div>
  );
}

function EquationSide({ parts, label, showCompartments }: { parts: Participant[]; label: string; showCompartments?: boolean }) {
  const { index, state } = useApp();
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-faint">{label}</div>
      <ul className="space-y-1">
        {parts.map((p) => {
          const m = index.metabolites.get(p.metaboliteId);
          return (
            <li key={p.metaboliteId} className="flex items-baseline gap-2 text-[14px]">
              <span className="tabular w-6 shrink-0 text-right font-semibold text-ink-2">{p.stoichiometry}</span>
              <span className={cx("min-w-0", m?.currency && "text-muted")}>
                <EntityLink refTo={{ type: "metabolite", id: p.metaboliteId }} hideInQuiz={!m?.currency} className={m?.currency ? "font-normal text-muted" : ""}>
                  {m ? (state.preferRu && m.nameRu) || m.name : p.metaboliteId}
                </EntityLink>
              </span>
              <span className="ml-auto flex shrink-0 items-center gap-1.5">
                {showCompartments && m && <CompartmentChip id={m.compartmentId} />}
                {m?.formula && !state.quizMode && <span className="tabular text-[11px] text-faint">{prettyFormula(m.formula)}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
