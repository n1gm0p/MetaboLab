"use client";

import { useMemo, useState } from "react";
import { Network, Share2 } from "lucide-react";
import { directionalReactions } from "@/lib/data/metabo-index";
import { chebiUrl, keggCompoundUrl, prettyFormula } from "@/lib/format";
import { useApp } from "@/components/state/app-state";
import { useNavigator } from "@/components/state/use-navigator";
import { Chip, ExtLink, Section, TextButton, cx } from "@/components/ui/primitives";
import { CardHeader, CompartmentChip, ReactionRow, SourcesSection, SummarySection, useDetails } from "./common";
import { CardActions } from "./CardActions";

const KIND_LABEL = {
  "small-molecule": "Вещество",
  set: "Группа веществ",
  macromolecule: "Макромолекула",
  complex: "Комплекс",
  polymer: "Полимер",
  other: "Участник реакции",
} as const;

const LIST_LIMIT = 12;

export function MetaboliteCard({ id }: { id: string }) {
  const { index, state } = useApp();
  const nav = useNavigator();
  const m = index.metabolites.get(id);
  const { details, loading, error } = useDetails(m ? id : undefined);
  const chebiDetails = useDetails(m?.chebiId);
  const [showAll, setShowAll] = useState<{ in: boolean; out: boolean }>({ in: false, out: false });

  const { incoming, outgoing } = useMemo(() => directionalReactions(index, id), [index, id]);
  const variants = useMemo(() => (m?.chebiId ? (index.byChebi.get(m.chebiId) ?? []).filter((v) => v !== id) : []), [index, m, id]);
  const pathways = useMemo(() => {
    const ids = index.metabolitePathways.get(id) ?? [];
    // most specific first: pathways with direct reactions
    return ids
      .map((p) => index.pathways.get(p))
      .filter((p) => p !== undefined && p.reactionIds.length > 0)
      .sort((a, b) => (a!.nameRu ?? a!.name).localeCompare(b!.nameRu ?? b!.name, "ru"));
  }, [index, id]);

  if (!m) return <p className="p-5 text-muted">Вещество не найдено.</p>;
  const quiz = state.quizMode;
  const merged = details ?? chebiDetails.details;

  const list = (ids: string[], key: "in" | "out") => {
    const limited = showAll[key] ? ids : ids.slice(0, LIST_LIMIT);
    return (
      <>
        <ul className="-mx-3 space-y-0.5">
          {limited.map((rid) => (
            <ReactionRow key={rid} reactionId={rid} highlightId={id} tone={key} />
          ))}
        </ul>
        {ids.length > LIST_LIMIT && (
          <button type="button" onClick={() => setShowAll((s) => ({ ...s, [key]: !s[key] }))} className="mt-1 min-h-8 text-[12px] font-medium text-accent">
            {showAll[key] ? "Свернуть" : `Показать все (${ids.length})`}
          </button>
        )}
      </>
    );
  };

  return (
    <div>
      <CardHeader
        kicker={m.currency ? `${KIND_LABEL[m.kind]} · кофактор` : KIND_LABEL[m.kind]}
        title={(state.preferRu && m.nameRu) || m.name}
        subtitle={state.preferRu && m.nameRu ? m.name : m.nameRu}
        hideTitle={quiz}
        chips={
          <>
            <CompartmentChip id={m.compartmentId} />
            {m.abbreviation && !quiz && <Chip>{m.abbreviation}</Chip>}
            {m.formula && <Chip className="tabular">{prettyFormula(m.formula)}</Chip>}
          </>
        }
      />
      <CardActions refTo={{ type: "metabolite", id }}>
        <TextButton tone="accent" onClick={() => nav.showNeighborhood(id)} disabled={m.currency}>
          <Share2 className="h-3.5 w-3.5" /> Окрестность
        </TextButton>
        <TextButton onClick={() => nav.expandMetabolite(id)} disabled={m.currency}>
          <Network className="h-3.5 w-3.5" /> Добавить связи
        </TextButton>
      </CardActions>
      {m.currency && (
        <p className="mx-5 mb-3 rounded-xl bg-warn-soft px-3 py-2 text-[12px] leading-snug text-warn">
          Распространённый кофактор: участвует во множестве реакций. Не используется как промежуточное звено при поиске маршрутов и при раскрытии окрестности.
        </p>
      )}

      <Section title="Образуется в реакциях" count={incoming.length} accent="in">
        {incoming.length ? list(incoming, "in") : <p className="text-[13px] text-muted">В загруженной базе нет реакций, образующих это вещество в данном компартменте.</p>}
      </Section>
      <Section title="Превращается в реакциях" count={outgoing.length} accent="out">
        {outgoing.length ? list(outgoing, "out") : <p className="text-[13px] text-muted">В загруженной базе нет реакций, расходующих это вещество в данном компартменте.</p>}
      </Section>

      {variants.length > 0 && (
        <Section title="То же вещество в других компартментах" count={variants.length}>
          <div className="flex flex-wrap gap-1.5">
            {variants.map((v) => {
              const vm = index.metabolites.get(v);
              if (!vm) return null;
              return (
                <button key={v} type="button" onClick={() => nav.open({ type: "metabolite", id: v })} className="rounded-full hover:opacity-80">
                  <CompartmentChip id={vm.compartmentId} />
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[12px] text-muted">Разные компартменты — разные пулы вещества; они связаны только транспортными реакциями.</p>
        </Section>
      )}

      {pathways.length > 0 && (
        <Section title="Метаболические пути" count={pathways.length}>
          <ul className="flex flex-wrap gap-1.5">
            {pathways.slice(0, 30).map((p) => (
              <li key={p!.id}>
                <button
                  type="button"
                  onClick={() => nav.openPathway(p!.id)}
                  className="min-h-8 rounded-full border border-line px-3 text-[12px] text-ink-2 hover:border-accent hover:text-accent"
                >
                  {p!.nameRu ?? p!.name}
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <SummarySection details={merged} loading={loading || chebiDetails.loading} error={error && chebiDetails.error} />

      <Section title="Идентификаторы">
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
          {m.chebiId && (
            <>
              <dt className="text-muted">ChEBI</dt>
              <dd>
                <ExtLink href={chebiUrl(m.chebiId)}>{m.chebiId}</ExtLink>
              </dd>
            </>
          )}
          {m.keggId && (
            <>
              <dt className="text-muted">KEGG</dt>
              <dd>
                <ExtLink href={keggCompoundUrl(m.keggId)}>{m.keggId}</ExtLink>
              </dd>
            </>
          )}
          <dt className="text-muted">Заряд</dt>
          <dd className="tabular text-ink-2">
            {merged?.charge !== undefined ? (merged.charge > 0 ? `+${merged.charge}` : String(merged.charge)) : <span className="text-muted">неизвестен</span>}
            {merged?.charge !== undefined && <span className="text-[11px] text-muted"> (форма ChEBI, основная при pH 7,3)</span>}
          </dd>
          {merged?.mass !== undefined && (
            <>
              <dt className="text-muted">Масса</dt>
              <dd className="tabular text-ink-2">{merged.mass} Да</dd>
            </>
          )}
          {merged?.smiles && (
            <>
              <dt className="text-muted">SMILES</dt>
              <dd className="break-all font-mono text-[11px] text-ink-2">{merged.smiles}</dd>
            </>
          )}
          {merged?.inchiKey && (
            <>
              <dt className="text-muted">InChIKey</dt>
              <dd className="break-all font-mono text-[11px] text-ink-2">{merged.inchiKey}</dd>
            </>
          )}
          <dt className="text-muted">ID в базе</dt>
          <dd className="font-mono text-[11px] text-ink-2">{m.id}</dd>
        </dl>
        {m.synonyms.length > 0 && !quiz && (
          <div className="mt-3">
            <div className="mb-1 text-[11px] text-muted">Синонимы</div>
            <div className={cx("flex flex-wrap gap-1")}>
              {m.synonyms.slice(0, 16).map((s) => (
                <Chip key={s}>{s}</Chip>
              ))}
            </div>
          </div>
        )}
      </Section>

      <SourcesSection sources={m.sources} details={details} />
    </div>
  );
}
