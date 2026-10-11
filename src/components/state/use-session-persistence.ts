"use client";

import { useCallback, useEffect, useRef } from "react";
import type { MetaboIndex } from "@/lib/data/metabo-index";
import type { EntityRef, EntityType } from "@/lib/model/types";
import { useApp, type Action, type AppState, type PersistedState } from "./app-state";
import { useNavigator } from "./use-navigator";

const KEY = "metabomap:session:v1";
const TYPES: EntityType[] = ["metabolite", "reaction", "enzyme", "pathway"];

function exists(index: MetaboIndex, ref: EntityRef): boolean {
  switch (ref.type) {
    case "metabolite":
      return index.metabolites.has(ref.id);
    case "reaction":
      return index.reactions.has(ref.id);
    case "enzyme":
      return index.enzymes.has(ref.id);
    case "pathway":
      return index.pathways.has(ref.id);
  }
}

/** `#metabolite:R-ALL-70113` — a link to an entity that can be opened on another device. */
export function parseHash(hash: string): EntityRef | null {
  const m = decodeURIComponent(hash.replace(/^#/, "")).match(/^(metabolite|reaction|enzyme|pathway):(.+)$/);
  if (!m) return null;
  const type = m[1] as EntityType;
  return TYPES.includes(type) ? { type, id: m[2]! } : null;
}

/**
 * Restores the last map + card on load (localStorage, per device) and keeps the URL hash in sync
 * with the selected entity. Invalid ids (e.g. after a dataset update) are dropped silently.
 */
export function useSessionPersistence(
  index: MetaboIndex,
  state: AppState,
  dispatch: React.Dispatch<Action>,
  openFromHash: (ref: EntityRef) => void,
) {
  const restored = useRef(false);

  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    let saved: Partial<PersistedState> | null = null;
    try {
      const raw = localStorage.getItem(KEY);
      saved = raw ? (JSON.parse(raw) as Partial<PersistedState>) : null;
    } catch {
      saved = null;
    }
    if (saved && Array.isArray(saved.visibleReactionIds)) {
      const patch: Partial<PersistedState> = {
        visibleReactionIds: saved.visibleReactionIds.filter((r) => index.reactions.has(r)),
        mapContext: saved.mapContext,
        focus: saved.focus && exists(index, saved.focus) ? saved.focus : null,
        cofactorMode: saved.cofactorMode,
        preferRu: saved.preferRu,
        layout: saved.layout,
        hiddenCompartmentIds: saved.hiddenCompartmentIds ?? [],
      };
      if (!patch.visibleReactionIds?.length) patch.mapContext = { kind: "empty", label: "" };
      for (const k of Object.keys(patch) as (keyof PersistedState)[]) if (patch[k] === undefined) delete patch[k];
      dispatch({ type: "restore", patch });
    }
    const fromHash = parseHash(window.location.hash);
    if (fromHash && exists(index, fromHash)) openFromHash(fromHash);
  }, [index, dispatch, openFromHash]);

  // save (debounced)
  useEffect(() => {
    if (!restored.current) return;
    const t = setTimeout(() => {
      const data: PersistedState = {
        visibleReactionIds: state.visibleReactionIds,
        mapContext: state.mapContext,
        focus: state.focus,
        cofactorMode: state.cofactorMode,
        preferRu: state.preferRu,
        layout: state.layout,
        hiddenCompartmentIds: state.hiddenCompartmentIds,
      };
      try {
        localStorage.setItem(KEY, JSON.stringify(data));
      } catch {
        /* storage unavailable or full: the session simply is not remembered */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [
    state.visibleReactionIds,
    state.mapContext,
    state.focus,
    state.cofactorMode,
    state.preferRu,
    state.layout,
    state.hiddenCompartmentIds,
  ]);

  // links opened while the app is running (hash change without reload)
  useEffect(() => {
    const onHash = () => {
      const ref = parseHash(window.location.hash);
      if (ref && exists(index, ref)) openFromHash(ref);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [index, openFromHash]);

  // URL hash mirrors the selected entity
  useEffect(() => {
    if (!restored.current) return;
    const hash = state.focus ? `#${state.focus.type}:${encodeURIComponent(state.focus.id)}` : "";
    if (window.location.hash !== hash) history.replaceState(null, "", hash || window.location.pathname);
  }, [state.focus]);
}

/** Mount inside <AppContext.Provider>. */
export function SessionPersistence() {
  const { index, state, dispatch } = useApp();
  const nav = useNavigator();
  const openRef = useRef(nav.open);
  openRef.current = nav.open;
  const openFromHash = useCallback((ref: EntityRef) => openRef.current(ref), []);
  useSessionPersistence(index, state, dispatch, openFromHash);
  return null;
}
