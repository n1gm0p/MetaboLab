"use client";

import { useMemo } from "react";
import { ArrowRight, Search } from "lucide-react";
import { useApp } from "@/components/state/app-state";
import { useNavigator } from "@/components/state/use-navigator";
import { pluralRu } from "@/lib/format";

/** Starting points chosen by ChEBI id; only those present in the loaded dataset are shown. */
const STARTER_CHEBI = ["CHEBI:4167", "CHEBI:15361", "CHEBI:57288", "CHEBI:16810", "CHEBI:29985", "CHEBI:16113"];
const STARTER_PATHWAYS = ["R-HSA-70171", "R-HSA-71403", "R-HSA-71336", "R-HSA-70263", "R-HSA-70635", "R-HSA-77289"];

export function EmptyMap() {
  const { index } = useApp();
  const nav = useNavigator();

  const starters = useMemo(() => {
    const mets = STARTER_CHEBI.map((c) => {
      const ids = index.byChebi.get(c) ?? [];
      // prefer cytosolic form when several compartments exist
      const id = ids.find((i) => index.metabolites.get(i)?.compartmentId === "GO:0005829") ?? ids[0];
      return id ? index.metabolites.get(id) : undefined;
    }).filter((m) => m !== undefined);
    const pws = STARTER_PATHWAYS.map((p) => index.pathways.get(p)).filter((p) => p !== undefined);
    const fallbackMets = mets.length ? mets : index.dataset.metabolites.filter((m) => !m.currency).slice(0, 4);
    return { mets: fallbackMets, pws };
  }, [index]);

  const { reactions, metabolites, pathways } = index.dataset;

  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center p-6">
      <div className="pointer-events-auto w-full max-w-lg text-center animate-in">
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft">
          <svg viewBox="0 0 32 32" className="h-8 w-8 text-accent" aria-hidden>
            <circle cx="8" cy="9" r="3.2" fill="none" stroke="currentColor" strokeWidth="2" />
            <circle cx="24" cy="9" r="3.2" fill="none" stroke="currentColor" strokeWidth="2" />
            <circle cx="16" cy="24" r="3.2" fill="none" stroke="currentColor" strokeWidth="2" />
            <rect x="13.6" y="12.6" width="4.8" height="4.8" rx="1" transform="rotate(45 16 15)" fill="currentColor" />
            <path d="M10.6 10.8 14 13.4M21.4 10.8 18 13.4M16 17.6v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </div>
        <h1 className="text-[26px] font-semibold tracking-tight">Начните с любого вещества</h1>
        <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-muted">
          Найдите метаболит, фермент или путь — карта покажет связанные реакции. Двойное нажатие на вещество раскрывает его связи.
        </p>
        <p className="tabular mt-1.5 text-[12px] text-faint">
          В базе: {reactions.length} {pluralRu(reactions.length, "реакция", "реакции", "реакций")}, {metabolites.length}{" "}
          {pluralRu(metabolites.length, "участник", "участника", "участников")}, {pathways.length}{" "}
          {pluralRu(pathways.length, "путь", "пути", "путей")}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {starters.mets.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => nav.open({ type: "metabolite", id: m.id })}
              className="glass inline-flex min-h-10 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium hover:text-accent"
            >
              <Search className="h-3.5 w-3.5 opacity-60" />
              {m.nameRu ?? m.name}
            </button>
          ))}
        </div>
        {starters.pws.length > 0 && (
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {starters.pws.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => nav.openPathway(p.id)}
                className="inline-flex min-h-9 items-center gap-1 rounded-full px-3 text-[13px] text-accent hover:bg-accent-soft"
              >
                {p.nameRu ?? p.name}
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
