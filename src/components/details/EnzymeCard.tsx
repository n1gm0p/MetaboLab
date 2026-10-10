"use client";

import { Map as MapIcon } from "lucide-react";
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
  if (!e) return <p className="p-5 text-muted">Фермент не найден.</p>;

  return (
    <div>
      <CardHeader
        kicker="Фермент / катализатор"
        title={(state.preferRu && e.nameRu) || e.name}
        subtitle={state.preferRu && e.nameRu ? e.name : undefined}
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
              <dd className="text-ink-2">{e.activity}</dd>
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
