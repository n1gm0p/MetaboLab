"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Info } from "lucide-react";
import type { GraphModel } from "@/lib/graph/build";
import { compartmentName } from "@/lib/data/metabo-index";
import { useApp } from "@/components/state/app-state";
import { compartmentColor } from "@/components/graph/graph-style";
import { cx } from "@/components/ui/primitives";

export function MapLegend({ model }: { model: GraphModel }) {
  const { index, state, dispatch } = useApp();
  const [open, setOpen] = useState(false);

  const compartments = useMemo(() => {
    const counts = new Map<string, number>();
    for (const rid of state.visibleReactionIds) {
      const r = index.reactions.get(rid);
      for (const c of r?.compartmentIds ?? []) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [state.visibleReactionIds, index]);
  void model;

  /** pathways with reactions on the map (only those with direct reactions, most represented first) */
  const pathways = useMemo(() => {
    const counts = new Map<string, number>();
    for (const rid of state.visibleReactionIds)
      for (const p of index.reactions.get(rid)?.pathwayIds ?? []) counts.set(p, (counts.get(p) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [state.visibleReactionIds, index]);

  return (
    <div className="glass absolute bottom-4 left-4 z-10 w-60 rounded-2xl text-[12px] max-md:bottom-auto max-md:left-2 max-md:top-16 max-md:w-56">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-10 w-full items-center gap-2 px-3.5 text-left font-medium"
        aria-expanded={open}
      >
        <Info className="h-3.5 w-3.5 text-muted" />
        Легенда и компартменты
        <ChevronDown className={cx("ml-auto h-4 w-4 text-muted transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-line px-3.5 pb-3.5 pt-3 animate-in">
          <div className="space-y-1.5">
            <LegendRow swatch={<span className="h-4 w-8 rounded-md border-[1.5px] border-accent bg-panel-solid" />} label="Метаболит (цвет рамки — компартмент)" />
            <LegendRow swatch={<span className="h-3 w-6 rounded border border-dashed border-faint" />} label="Кофактор / «валютный» метаболит" />
            <LegendRow swatch={<span className="ml-2 h-2.5 w-2.5 rotate-45 rounded-[2px] bg-muted" />} label="Реакция (подпись — EC)" />
            <LegendRow swatch={<span className="ml-1.5 h-2.5 w-4 rounded-[3px] bg-[#30b0c7]" />} label="Транспорт между компартментами" />
            <LegendRow swatch={<span className="h-0.5 w-8 rounded bg-in" />} label="Реакции образования" />
            <LegendRow swatch={<span className="h-0.5 w-8 rounded bg-out" />} label="Реакции превращения" />
            <LegendRow swatch={<span className="h-0.5 w-8 rounded bg-route" />} label="Найденный маршрут" />
          </div>
          {pathways.length > 1 && (
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">Показать реакции пути</span>
              <select
                value={state.mapPathwayFilter ?? ""}
                onChange={(e) => dispatch({ type: "setMapPathwayFilter", pathwayId: e.target.value || null })}
                className="h-9 w-full rounded-lg border border-line-strong bg-panel-solid px-2 text-[12px]"
              >
                <option value="">Все пути на карте</option>
                {pathways.map(([pid, n]) => (
                  <option key={pid} value={pid}>
                    {index.pathways.get(pid)?.nameRu ?? index.pathways.get(pid)?.name} ({n})
                  </option>
                ))}
              </select>
            </label>
          )}
          {compartments.length > 0 && (
            <div>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">Компартменты на карте</div>
              <ul className="space-y-0.5">
                {compartments.map(([id, n]) => {
                  const hidden = state.hiddenCompartmentIds.includes(id);
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => dispatch({ type: "toggleCompartment", id })}
                        className={cx("flex min-h-8 w-full items-center gap-2 rounded-md px-1.5 text-left hover:bg-hover", hidden && "opacity-45")}
                        aria-pressed={!hidden}
                        title={hidden ? "Показать реакции компартмента" : "Скрыть реакции компартмента"}
                      >
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: compartmentColor(id) }} />
                        <span className={cx("truncate", hidden && "line-through")}>{compartmentName(index, id)}</span>
                        <span className="tabular ml-auto text-faint">{n}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LegendRow({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2.5 text-ink-2">
      <span className="flex w-9 shrink-0 items-center">{swatch}</span>
      <span>{label}</span>
    </div>
  );
}
