"use client";

import { useEffect, useState } from "react";
import { ArrowLeftRight, ArrowRight } from "lucide-react";
import type { EntityRef, Participant, RecordDetails, SourceRef } from "@/lib/model/types";
import { loadDetails } from "@/lib/data/details";
import { compartmentName } from "@/lib/data/metabo-index";
import { pubmedUrl } from "@/lib/format";
import { useApp } from "@/components/state/app-state";
import { useNavigator } from "@/components/state/use-navigator";
import { compartmentColor } from "@/components/graph/graph-style";
import { Chip, ExtLink, Reveal, Section, cx } from "@/components/ui/primitives";

export function useDetails(id: string | undefined): { details: RecordDetails | null; loading: boolean; error: boolean } {
  const { index } = useApp();
  const shards = index.dataset.meta.detailShards;
  const [state, setState] = useState<{ id?: string; details: RecordDetails | null; error: boolean }>({ details: null, error: false });
  useEffect(() => {
    if (!id || shards <= 0) return;
    let alive = true;
    loadDetails(id, shards)
      .then((d) => alive && setState({ id, details: d, error: false }))
      .catch(() => alive && setState({ id, details: null, error: true }));
    return () => {
      alive = false;
    };
  }, [id, shards]);
  const loading = !!id && shards > 0 && state.id !== id;
  return { details: state.id === id ? state.details : null, loading, error: state.id === id && state.error };
}

export function CompartmentChip({ id }: { id: string }) {
  const { index } = useApp();
  return (
    <Chip>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: compartmentColor(id) }} />
      {compartmentName(index, id)}
    </Chip>
  );
}

/** Clickable name of an entity that opens its card. */
export function EntityLink({ refTo, children, className, hideInQuiz }: { refTo: EntityRef; children?: React.ReactNode; className?: string; hideInQuiz?: boolean }) {
  const nav = useNavigator();
  const { state } = useApp();
  const label = children ?? nav.nameOf(refTo);
  return (
    <Reveal hidden={!!hideInQuiz && state.quizMode} placeholder="?">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          nav.open(refTo);
        }}
        className={cx("text-left font-medium text-ink hover:text-accent hover:underline", className)}
      >
        {label}
      </button>
    </Reveal>
  );
}

export function ParticipantList({ parts, highlightId }: { parts: Participant[]; highlightId?: string }) {
  const { index, state } = useApp();
  return (
    <span className="inline">
      {parts.map((p, i) => {
        const m = index.metabolites.get(p.metaboliteId);
        const name = m ? (state.preferRu && m.nameRu) || m.name : p.metaboliteId;
        return (
          <span key={`${p.metaboliteId}-${i}`}>
            {i > 0 && <span className="text-faint"> + </span>}
            {p.stoichiometry !== 1 && <span className="tabular font-semibold text-ink-2">{p.stoichiometry} </span>}
            <span className={cx(m?.currency && "text-muted", p.metaboliteId === highlightId && "font-semibold text-ink")}>
              {state.quizMode && !m?.currency && p.metaboliteId !== highlightId ? "?" : name}
            </span>
          </span>
        );
      })}
    </span>
  );
}

/** Compact reaction row used in metabolite / enzyme / pathway cards. */
export function ReactionRow({ reactionId, highlightId, tone }: { reactionId: string; highlightId?: string; tone?: "in" | "out" }) {
  const { index, state } = useApp();
  const nav = useNavigator();
  const r = index.reactions.get(reactionId);
  if (!r) return null;
  const enzymes = r.enzymeIds.map((e) => index.enzymes.get(e)).filter((e) => e !== undefined);
  return (
    <li>
      <button
        type="button"
        onClick={() => nav.open({ type: "reaction", id: r.id })}
        className={cx(
          "group w-full rounded-xl border border-transparent px-3 py-2.5 text-left transition-colors hover:border-line hover:bg-hover",
          tone === "in" && "border-l-in/40",
        )}
      >
        <div className="text-[13px] leading-snug text-ink-2">
          <ParticipantList parts={r.inputs} highlightId={highlightId} />{" "}
          {r.reversible ? (
            <ArrowLeftRight className="mx-0.5 inline h-3.5 w-3.5 text-muted" aria-label="обратимо" />
          ) : (
            <ArrowRight className={cx("mx-0.5 inline h-3.5 w-3.5", tone === "in" ? "text-in" : tone === "out" ? "text-out" : "text-muted")} aria-label="необратимо" />
          )}{" "}
          <ParticipantList parts={r.outputs} highlightId={highlightId} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
          {enzymes.length > 0 && !state.quizMode && (
            <span className="truncate">{enzymes.map((e) => e.nameRu ?? e.name).join(", ")}</span>
          )}
          {r.ecNumbers.length > 0 && !state.quizMode && <span className="tabular">EC {r.ecNumbers.join(", ")}</span>}
          {r.isTransport && <Chip tone="accent">транспорт</Chip>}
        </div>
      </button>
    </li>
  );
}

const SOURCE_LABEL: Record<SourceRef["db"], string> = {
  reactome: "Reactome",
  rhea: "Rhea",
  chebi: "ChEBI",
  kegg: "KEGG",
  pubchem: "PubChem",
  go: "Gene Ontology",
  pubmed: "PubMed",
  ec: "ENZYME (EC)",
  uniprot: "UniProt",
  curated: "MetaboMap (курировано)",
};

export function SourcesSection({ sources, details }: { sources: SourceRef[]; details?: RecordDetails | null }) {
  const lit = details?.literature ?? [];
  return (
    <Section title="Источники" count={sources.length + lit.length}>
      <ul className="space-y-1.5 text-[13px]">
        {sources.map((s) => (
          <li key={`${s.db}:${s.id}`} className="flex items-baseline gap-2">
            <span className="w-28 shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted">{SOURCE_LABEL[s.db]}</span>
            {s.url ? <ExtLink href={s.url}>{s.label ?? s.id}</ExtLink> : <span className="text-ink-2">{s.label ?? s.id}</span>}
          </li>
        ))}
      </ul>
      {lit.length > 0 && (
        <>
          <div className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">Литература (по данным источника)</div>
          <ol className="space-y-2 text-[12px] leading-snug">
            {lit.map((l, i) => (
              <li key={`${l.pubmedId ?? l.title}-${i}`} className="text-ink-2">
                {l.pubmedId ? <ExtLink href={pubmedUrl(l.pubmedId)}>{l.title}</ExtLink> : l.title}
                <span className="text-muted">
                  {l.journal ? ` — ${l.journal}` : ""}
                  {l.year ? `, ${l.year}` : ""}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </Section>
  );
}

export function SummarySection({ details, loading, error, title = "Описание" }: { details: RecordDetails | null; loading: boolean; error: boolean; title?: string }) {
  if (loading)
    return (
      <Section title={title}>
        <div className="space-y-2">
          <div className="h-3 w-full animate-pulse rounded bg-hover" />
          <div className="h-3 w-4/5 animate-pulse rounded bg-hover" />
        </div>
      </Section>
    );
  if (error)
    return (
      <Section title={title}>
        <p className="text-[13px] text-muted">Не удалось загрузить подробности (нет сети?).</p>
      </Section>
    );
  if (!details?.summary && !details?.definition) return null;
  return (
    <Section title={title}>
      {details.definition && (
        <p className="text-[13px] leading-relaxed text-ink-2">
          {stripTags(details.definition)} <span className="text-[11px] text-muted">— ChEBI</span>
        </p>
      )}
      {details.summary && (
        <p className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-ink-2 first:mt-0">
          {stripTags(details.summary)}
          {details.summarySource && (
            <span className="text-[11px] text-muted">
              {" "}
              — {details.summarySource.url ? <ExtLink href={details.summarySource.url}>{details.summarySource.label ?? details.summarySource.db}</ExtLink> : details.summarySource.label}
            </span>
          )}
        </p>
      )}
    </Section>
  );
}

/** Source texts sometimes contain simple HTML (<i>, <sub>); render them as plain text. */
export function stripTags(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function CardHeader({
  kicker,
  title,
  subtitle,
  chips,
  hideTitle,
}: {
  kicker: string;
  title: string;
  subtitle?: string;
  chips?: React.ReactNode;
  hideTitle?: boolean;
}) {
  return (
    <div className="px-5 pb-4 pt-1">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{kicker}</div>
      <h2 className="mt-1 text-[22px] font-semibold leading-tight tracking-tight">
        <Reveal hidden={!!hideTitle} placeholder="Показать название">
          {title}
        </Reveal>
      </h2>
      {subtitle && !hideTitle && <div className="mt-1 text-[13px] text-muted">{subtitle}</div>}
      {chips && <div className="mt-3 flex flex-wrap gap-1.5">{chips}</div>}
    </div>
  );
}
