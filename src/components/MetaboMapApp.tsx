"use client";

import { useEffect, useMemo, useReducer } from "react";
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

export function MetaboMapApp({ dataset }: { dataset: Dataset }) {
  const index = useMemo(() => buildIndex(dataset), [dataset]);
  const searchIndex = useMemo(() => buildSearchIndex(index), [index]);
  const [state, dispatch] = useReducer(reducer, initialState);

  // On tablets/phones there is no room for both side panels next to the map.
  useEffect(() => {
    if (state.rightOpen && state.leftOpen && window.matchMedia("(max-width: 1099px)").matches) {
      dispatch({ type: "setLeftOpen", value: false });
    }
  }, [state.rightOpen, state.focus]);

  useEffect(() => {
    if (window.matchMedia("(max-width: 767px)").matches) dispatch({ type: "setLeftOpen", value: false });
  }, []);

  const ctx = useMemo(() => ({ index, searchIndex, state, dispatch }), [index, searchIndex, state]);

  return (
    <AppContext.Provider value={ctx}>
      <Tooltip.Provider>
        <div className="flex h-dvh flex-col">
          <TopBar />
          <main className="relative min-h-0 flex-1">
            <MapView />
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
    </AppContext.Provider>
  );
}
