"use client";

import { useMemo } from "react";
import { Map as MapIcon, Minus, Plus } from "lucide-react";
import { ecUrl } from "@/lib/format";
import { useApp } from "@/components/state/app-state";
import { MAX_REACTIONS_ON_MAP } from "@/components/state/use-navigator";
import { Chip, ExtLink, Section, TextButton } from "@/components/ui/primitives";
import { CardHeader, CompartmentChip, EntityLink, ReactionRow, SourcesSection, SummarySection, useDetails } from "./common";
import { CardActions } from "./CardActions";

export function EnzymeCard({ id }: { id: string }) {
  const { index, state, dispatch } = useApp();
  const e = index.enzymes.get(id);
  const { details, loading, error } = useDetails(e ? id : undefined);
  /** main substrates/products and regulation over all reactions of this catalyst (from the records) */
  const summary = useMemo(() => {
    const subs = new Map<string, number>();
    const prods = new Map<string, number>();
    const regulation: { reactionId: string; type: string; name: string }[] = [];
    for (const rid of e?.reactionIds ?? []) {
      const r = index.reactions.get(rid);
      if (!r) continue;
      for (const p of r.inputs) if (!index.metabolites.get(p.metaboliteId)?.currency) subs.set(p.metaboliteId, (subs.get(p.metaboliteId) ?? 0) + 1);
      for (const p of r.outputs) if (!index.metabolites.get(p.metaboliteId)?.currency) prods.set(p.metaboliteId, (prods.get(p.metaboliteId) ?? 0) + 1);
      for (const g of r.regulation) regulation.push({ reactionId: rid, type: g.type, name: g.regulatorName });
    }
    const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    return { substrates: top(subs), products: top(prods), regulation };
  }, [e, index]);
  if (!e) return <p className="p-5 text-muted">Фермент не найден.</p>;

  return (
    <div>
      <CardHeader
        kicker="Фермент / катализатор"
        title={(state.preferRu && e.nameRu) || e.name}
        subtitle={e.activityRu ? `Активность: ${e.activityRu}` : state.preferRu && e.nameRu ? e.name : undefined}
        hideTitle={state.quizMode}
        chips={
          <>
            {e.ecNumbers.map((ec) => (
              <Chip key={ec} tone="in">
                EC {ec}
              </Chip>
            ))}
            {e.compartmentIds.map((c) => (
              <CompartmentChip key={c} id={c} />
            ))}
          </>
        }
      />
      <CardActions refTo={{ type: "enzyme", id }}>
        <TextButton
          tone="accent"
          onClick={() =>
            dispatch({
              type: "showReactions",
              reactionIds: e.reactionIds.slice(0, MAX_REACTIONS_ON_MAP),
              context: { kind: "custom", label: `Реакции: ${e.nameRu ?? e.name}` },
              layout: "organic",
            })
          }
        >
          <MapIcon className="h-3.5 w-3.5" /> Реакции на карте
        </TextButton>
      </CardActions>

      <Section title="Свойства">
        <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
          {e.genes.length > 0 && (
            <>
              <dt className="text-muted">Гены</dt>
              <dd className="text-ink-2">{state.quizMode ? "—" : e.genes.join(", ")}</dd>
            </>
          )}
          {e.activity && (
            <>
              <dt className="text-muted">Активность (GO)</dt>
              <dd className="text-ink-2">
                {e.activity}
                {e.activityRu && <span className="block text-muted">{e.activityRu} (по номеру EC)</span>}
              </dd>
            </>
          )}
          {e.ecNumbers.length > 0 && (
            <>
              <dt className="text-muted">EC</dt>
              <dd className="flex flex-wrap gap-2">
                {e.ecNumbers.map((ec) => (
                  <ExtLink key={ec} href={ecUrl(ec)}>
                    {ec}
                  </ExtLink>
                ))}
              </dd>
            </>
          )}
          <dt className="text-muted">Кофакторы</dt>
          <dd className="text-ink-2">
            {e.cofactorIds.length === 0 ? (
              <span className="text-muted">не указаны в составе катализатора</span>
            ) : (
              <span className="flex flex-wrap gap-1.5">
                {e.cofactorIds.map((c) => (
                  <EntityLink key={c} refTo={{ type: "metabolite", id: c }} />
                ))}
              </span>
            )}
          </dd>
        </dl>
        {e.synonyms.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {e.synonyms.slice(0, 12).map((s) => (
              <Chip key={s}>{s}</Chip>
            ))}
          </div>
        )}
      </Section>

      <Section title="Субстраты и продукты (по реакциям)">
        <div className="space-y-2 text-[13px]">
          {(["substrates", "products"] as const).map((k) => (
            <div key={k}>
              <div className="mb-1 text-[11px] text-muted">{k === "substrates" ? "Субстраты" : "Продукты"}</div>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {summary[k].length === 0 && <span className="text-muted">—</span>}
                {summary[k].slice(0, 20).map((m) => (
                  <EntityLink key={m} refTo={{ type: "metabolite", id: m }} hideInQuiz />
                ))}
                {summary[k].length > 20 && <span className="text-muted">и ещё {summary[k].length - 20}</span>}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Регуляция реакций (по данным источника)" count={summary.regulation.length}>
        {summary.regulation.length === 0 ? (
          <p className="text-[13px] text-muted">В источнике регуляция реакций этого катализатора не описана.</p>
        ) : (
          <ul className="space-y-1 text-[13px]">
            {summary.regulation.slice(0, 15).map((g, i) => (
              <li key={`${g.reactionId}-${i}`} className="flex items-start gap-2">
                <span className={g.type === "negative" ? "mt-0.5 text-out" : "mt-0.5 text-in"}>
                  {g.type === "negative" ? <Minus className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                </span>
                <span className="text-ink-2">{state.quizMode ? "?" : g.name}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Катализируемые реакции" count={e.reactionIds.length}>
        <ul className="-mx-3 space-y-0.5">
          {e.reactionIds.slice(0, 40).map((r) => (
            <ReactionRow key={r} reactionId={r} />
          ))}
        </ul>
      </Section>

      <SummarySection details={details} loading={loading} error={error} />
      <SourcesSection sources={e.sources} details={details} />
    </div>
  );
}
