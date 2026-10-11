"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { TriangleAlert, X } from "lucide-react";
import * as Tooltip from "@radix-ui/react-tooltip";
import type { Dataset } from "@/lib/model/types";
import { buildIndex } from "@/lib/data/metabo-index";
import { buildSearchIndex } from "@/lib/search/search";
import { AppContext, initialState, reducer } from "@/components/state/app-state";
import { TopBar } from "@/components/layout/TopBar";
import { LeftPanel } from "@/components/layout/LeftPanel";
import { DetailPanel } from "@/components/details/DetailPanel";
import { MapView } from "@/components/map/MapView";
import { cx } from "@/components/ui/primitives";
import { UserDataProvider } from "@/components/library/user-data";
import { SessionPersistence } from "@/components/state/use-session-persistence";

export function MetaboMapApp({ dataset, warning }: { dataset: Dataset; warning?: string }) {
  const [showWarning, setShowWarning] = useState(!!warning);
  const index = useMemo(() => buildIndex(dataset), [dataset]);
  const searchIndex = useMemo(() => buildSearchIndex(index), [index]);
  const [state, dispatch] = useReducer(reducer, initialState);

  // On tablets/phones there is no room for both side panels next to the map:
  // whichever panel was opened last wins.
  const prevLeft = useRef(state.leftOpen);
  useEffect(() => {
    const narrow = window.matchMedia("(max-width: 1099px)").matches;
    const leftJustOpened = state.leftOpen && !prevLeft.current;
    prevLeft.current = state.leftOpen;
    if (!narrow || !state.leftOpen || !state.rightOpen) return;
    if (leftJustOpened) dispatch({ type: "setRightOpen", value: false });
    else dispatch({ type: "setLeftOpen", value: false });
  }, [state.leftOpen, state.rightOpen, state.focus]);

  useEffect(() => {
    if (window.matchMedia("(max-width: 767px)").matches) dispatch({ type: "setLeftOpen", value: false });
  }, []);

  // Escape closes the card (unless the user is typing or a dialog/menu handles it)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.closest("[role=dialog]"))) return;
      dispatch({ type: "setRightOpen", value: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ctx = useMemo(() => ({ index, searchIndex, state, dispatch }), [index, searchIndex, state]);

  return (
    <AppContext.Provider value={ctx}>
      <UserDataProvider>
      <SessionPersistence />
      <Tooltip.Provider>
        <div className="flex h-dvh flex-col">
          <TopBar />
          <main className="relative min-h-0 flex-1">
            <MapView />
            {showWarning && warning && (
              <div role="alert" className="glass absolute left-1/2 top-14 z-30 flex max-w-[min(560px,calc(100vw-24px))] -translate-x-1/2 items-start gap-2 rounded-xl px-3 py-2 text-[13px] text-warn">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="flex-1">{warning}</span>
                <button type="button" aria-label="Скрыть" onClick={() => setShowWarning(false)} className="grid h-6 w-6 place-items-center rounded-md hover:bg-hover">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <aside
              aria-label="Навигация"
              className={cx(
                "glass absolute bottom-3 left-3 top-3 z-20 flex w-[288px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-2xl transition-[transform,opacity] duration-200",
                state.leftOpen ? "translate-x-0 opacity-100" : "pointer-events-none -translate-x-[calc(100%+24px)] opacity-0",
              )}
            >
              <LeftPanel />
            </aside>
            <aside
              aria-label="Карточка элемента"
              className={cx(
                "glass absolute z-20 flex flex-col overflow-hidden rounded-2xl transition-[transform,opacity] duration-200",
                "bottom-3 right-3 top-3 w-[400px] max-w-[calc(100vw-24px)]",
                "max-sm:inset-x-2 max-sm:top-[38%] max-sm:bottom-2 max-sm:w-auto max-sm:max-w-none",
                state.rightOpen && state.focus ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-[calc(100%+24px)] opacity-0 max-sm:translate-x-0 max-sm:translate-y-[110%]",
              )}
            >
              <DetailPanel />
            </aside>
          </main>
        </div>
      </Tooltip.Provider>
      </UserDataProvider>
    </AppContext.Provider>
  );
}
