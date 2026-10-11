"use client";

import { useMemo } from "react";
import { Map as MapIcon } from "lucide-react";
import { linkedPathways, pathwayBoundary } from "@/lib/data/pathway-analysis";
import { pluralRu } from "@/lib/format";
import { useApp } from "@/components/state/app-state";
import { MAX_REACTIONS_ON_MAP, useNavigator } from "@/components/state/use-navigator";
import { Chip, Section, TextButton } from "@/components/ui/primitives";
import { CardHeader, EntityLink, SourcesSection, SummarySection, useDetails } from "./common";
import { CardActions } from "./CardActions";

export function PathwayCard({ id }: { id: string }) {
  const { index, state } = useApp();
  const nav = useNavigator();
  const p = index.pathways.get(id);
  const { details, loading, error } = useDetails(p ? id : undefined);
  const reactionIds = index.pathwayReactionsDeep.get(id) ?? [];
  const boundary = useMemo(() => pathwayBoundary(index, id), [index, id]);
  const links = useMemo(() => linkedPathways(index, id), [index, id]);
  if (!p) return <p className="p-5 text-muted">Путь не найден.</p>;
  const tooBig = reactionIds.length > MAX_REACTIONS_ON_MAP;
  const onMap = state.mapContext.kind === "pathway" && state.mapContext.refId === id;

  const metList = (ids: string[]) => (
    <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-[13px]">
      {ids.slice(0, 40).map((m) => (
        <EntityLink key={m} refTo={{ type: "metabolite", id: m }} hideInQuiz />
      ))}
      {ids.length > 40 && <span className="text-muted">и ещё {ids.length - 40}</span>}
    </div>
  );

  return (
    <div>
      <CardHeader
        kicker="Метаболический путь"
        title={(state.preferRu && p.nameRu) || p.name}
        subtitle={state.preferRu && p.nameRu ? p.name : undefined}
        chips={
          <>
            <Chip>
              {reactionIds.length} {pluralRu(reactionIds.length, "реакция", "реакции", "реакций")}
            </Chip>
            {p.subpathwayIds.length > 0 && (
              <Chip>
                {p.subpathwayIds.length} {pluralRu(p.subpathwayIds.length, "подпуть", "подпути", "подпутей")}
              </Chip>
            )}
          </>
        }
      />
      <CardActions refTo={{ type: "pathway", id }}>
        <TextButton tone="accent" disabled={tooBig || reactionIds.length === 0 || onMap} onClick={() => nav.openPathway(id)}>
          <MapIcon className="h-3.5 w-3.5" /> {onMap ? "Показан на карте" : "Показать на карте"}
        </TextButton>
      </CardActions>
      {tooBig && (
        <p className="mx-5 mb-3 rounded-xl bg-hover px-3 py-2 text-[12px] leading-snug text-ink-2">
          Путь слишком велик для одновременного отображения ({reactionIds.length} реакций). Выберите подпуть ниже или начните с конкретного вещества.
        </p>
      )}

      {p.subpathwayIds.length > 0 && (
        <Section title="Подпути" count={p.subpathwayIds.length}>
          <ul className="-mx-2 space-y-0.5">
            {p.subpathwayIds.map((s) => {
              const sp = index.pathways.get(s);
              if (!sp) return null;
              const n = index.pathwayReactionsDeep.get(s)?.length ?? 0;
              return (
                <li key={s}>
                  <button type="button" onClick={() => nav.openPathway(s)} className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] hover:bg-hover">
                    <span className="flex-1">{sp.nameRu ?? sp.name}</span>
                    <span className="tabular text-[11px] text-muted">{n}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {reactionIds.length > 0 && (
        <>
          <Section title="Входы пути" count={boundary.inputs.length} accent="in">
            {boundary.inputs.length ? metList(boundary.inputs) : <p className="text-[13px] text-muted">Нет</p>}
          </Section>
          <Section title="Выходы пути" count={boundary.outputs.length} accent="out">
            {boundary.outputs.length ? metList(boundary.outputs) : <p className="text-[13px] text-muted">Нет</p>}
            <p className="mt-2 text-[11px] text-faint">
              Вычислено по реакциям пути: малые молекулы, которые только расходуются (входы) или только образуются (выходы); кофакторы и белки исключены.
            </p>
          </Section>
        </>
      )}

      {links.length > 0 && (
        <Section title="Связанные пути (общие метаболиты)" count={links.length}>
          <ul className="-mx-2 space-y-0.5">
            {links.map((l) => (
              <li key={l.pathwayId}>
                <button type="button" onClick={() => nav.openPathway(l.pathwayId)} className="w-full rounded-lg px-2 py-2 text-left hover:bg-hover">
                  <div className="text-[13px] font-medium">{nav.nameOf({ type: "pathway", id: l.pathwayId })}</div>
                  <div className="mt-0.5 line-clamp-2 text-[12px] text-muted">
                    {state.quizMode
                      ? `${l.sharedMetaboliteIds.length} общих веществ`
                      : l.sharedMetaboliteIds
                          .slice(0, 6)
                          .map((m) => nav.nameOf({ type: "metabolite", id: m }))
                          .join(", ") + (l.sharedMetaboliteIds.length > 6 ? ` +${l.sharedMetaboliteIds.length - 6}` : "")}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <SummarySection details={details} loading={loading} error={error} title="Описание (Reactome)" />
      <SourcesSection sources={p.sources} details={details} />
    </div>
  );
}
