"use client";

import { createContext, useContext } from "react";
import type { MetaboIndex } from "@/lib/data/metabo-index";
import type { CofactorMode } from "@/lib/graph/build";
import type { EntityRef } from "@/lib/model/types";
import type { SearchIndex } from "@/lib/search/search";
import type { RouteResult } from "@/lib/graph/route";

export type LeftTab = "pathways" | "route" | "library";
export type LayoutMode = "hierarchical" | "organic";
/** overall level of detail on the map and in the cards */
export type DetailMode = "student" | "pro";

export interface MapContext {
  kind: "pathway" | "neighborhood" | "route" | "custom" | "empty";
  label: string;
  refId?: string;
}

export interface RouteEndpoint {
  metaboliteId: string;
  /** use every compartment-specific form of the same ChEBI compound */
  anyCompartment: boolean;
}

/** What is drawn on the map; stored to go back to a previous view. */
export interface MapSnapshot {
  visibleReactionIds: string[];
  hiddenMetaboliteIds: string[];
  mapContext: MapContext;
  layout: LayoutMode;
}

export interface AppState {
  /** previous map views (most recent last) */
  mapHistory: MapSnapshot[];
  /** show only reactions of this pathway among those on the map */
  mapPathwayFilter: string | null;
  /** reactions currently drawn on the map */
  visibleReactionIds: string[];
  hiddenMetaboliteIds: string[];
  hiddenCompartmentIds: string[];
  mapContext: MapContext;
  focus: EntityRef | null;
  back: EntityRef[];
  cofactorMode: CofactorMode;
  preferRu: boolean;
  quizMode: boolean;
  /** "student" = strict backbone / basics; "pro" = full detail */
  detailMode: DetailMode;
  layout: LayoutMode;
  layoutNonce: number;
  /** bumped to reset node positions to the fixed teaching skeleton */
  resetNonce: number;
  fitNonce: number;
  /** metabolite node id that was expanded last (layout anchors new nodes around it) */
  expandAnchor?: string;
  activeRoute: RouteResult | null;
  activeRoutePath: number;
  routeFrom: RouteEndpoint | null;
  routeTo: RouteEndpoint | null;
  /** review of saved cards (self-check) */
  review: { items: EntityRef[]; i: number } | null;
  leftTab: LeftTab;
  leftOpen: boolean;
  rightOpen: boolean;
}

export const initialState: AppState = {
  mapHistory: [],
  mapPathwayFilter: null,
  visibleReactionIds: [],
  hiddenMetaboliteIds: [],
  hiddenCompartmentIds: [],
  mapContext: { kind: "empty", label: "" },
  focus: null,
  back: [],
  cofactorMode: "duplicate",
  preferRu: true,
  quizMode: false,
  detailMode: "student",
  layout: "organic",
  layoutNonce: 0,
  resetNonce: 0,
  fitNonce: 0,
  activeRoute: null,
  activeRoutePath: 0,
  routeFrom: null,
  routeTo: null,
  review: null,
  leftTab: "pathways",
  leftOpen: true,
  rightOpen: false,
};

export type Action =
  | { type: "showReactions"; reactionIds: string[]; context: MapContext; layout?: LayoutMode; focus?: EntityRef | null }
  | { type: "addReactions"; reactionIds: string[]; anchor?: string }
  | { type: "removeReactions"; reactionIds: string[] }
  | { type: "hideMetabolite"; id: string }
  | { type: "unhideAll" }
  | { type: "toggleCompartment"; id: string }
  | { type: "focus"; ref: EntityRef | null; pushHistory?: boolean }
  | { type: "back" }
  | { type: "setCofactorMode"; mode: CofactorMode }
  | { type: "setPreferRu"; value: boolean }
  | { type: "setQuiz"; value: boolean }
  | { type: "setDetailMode"; mode: DetailMode }
  | { type: "setLayout"; layout: LayoutMode }
  | { type: "relayout" }
  | { type: "resetLayout" }
  | { type: "fit" }
  | { type: "setRoute"; route: RouteResult | null }
  | { type: "selectRoutePath"; index: number }
  | { type: "setRouteEndpoint"; end: "from" | "to"; value: RouteEndpoint | null; openPanel?: boolean }
  | { type: "swapRouteEndpoints" }
  | { type: "setReview"; review: { items: EntityRef[]; i: number } | null }
  | { type: "setLeftTab"; tab: LeftTab }
  | { type: "setLeftOpen"; value: boolean }
  | { type: "setRightOpen"; value: boolean }
  | { type: "clearMap" }
  | { type: "undoMap" }
  | { type: "setMapPathwayFilter"; pathwayId: string | null }
  | { type: "restore"; patch: Partial<PersistedState> };

/** The part of the state that survives reloads (see use-session-persistence). */
export type PersistedState = Pick<
  AppState,
  "visibleReactionIds" | "mapContext" | "focus" | "cofactorMode" | "preferRu" | "detailMode" | "layout" | "hiddenCompartmentIds"
>;

const sameRef = (a: EntityRef | null, b: EntityRef | null) => !!a && !!b && a.type === b.type && a.id === b.id;

const snapshot = (s: AppState): MapSnapshot => ({
  visibleReactionIds: s.visibleReactionIds,
  hiddenMetaboliteIds: s.hiddenMetaboliteIds,
  mapContext: s.mapContext,
  layout: s.layout,
});

/** Remember the current view before replacing it (empty views and repeats are not stored). */
function pushHistory(s: AppState): MapSnapshot[] {
  if (s.visibleReactionIds.length === 0) return s.mapHistory;
  return [...s.mapHistory, snapshot(s)].slice(-20);
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "showReactions":
      return {
        ...state,
        mapHistory: pushHistory(state),
        mapPathwayFilter: null,
        visibleReactionIds: [...new Set(action.reactionIds)],
        hiddenMetaboliteIds: [],
        mapContext: action.context,
        layout: action.layout ?? state.layout,
        layoutNonce: state.layoutNonce + 1,
        expandAnchor: undefined,
        activeRoute: action.context.kind === "route" ? state.activeRoute : null,
        ...(action.focus !== undefined ? focusPatch(state, action.focus, true) : {}),
      };
    case "addReactions": {
      const set = new Set(state.visibleReactionIds);
      const before = set.size;
      for (const r of action.reactionIds) set.add(r);
      if (set.size === before) return state;
      return {
        ...state,
        mapHistory: pushHistory(state),
        visibleReactionIds: [...set],
        mapContext:
          state.mapContext.kind === "empty"
            ? { kind: "custom", label: "Моя карта" }
            : state.mapContext.kind === "custom"
              ? state.mapContext
              : { kind: "custom", label: `${state.mapContext.label} + связи` },
        expandAnchor: action.anchor,
        layoutNonce: state.layoutNonce + 1,
      };
    }
    case "removeReactions": {
      const rm = new Set(action.reactionIds);
      return { ...state, visibleReactionIds: state.visibleReactionIds.filter((r) => !rm.has(r)) };
    }
    case "hideMetabolite":
      return { ...state, hiddenMetaboliteIds: [...new Set([...state.hiddenMetaboliteIds, action.id])] };
    case "unhideAll":
      return { ...state, hiddenMetaboliteIds: [], hiddenCompartmentIds: [] };
    case "toggleCompartment": {
      const has = state.hiddenCompartmentIds.includes(action.id);
      return {
        ...state,
        hiddenCompartmentIds: has
          ? state.hiddenCompartmentIds.filter((c) => c !== action.id)
          : [...state.hiddenCompartmentIds, action.id],
      };
    }
    case "focus":
      return { ...state, ...focusPatch(state, action.ref, action.pushHistory ?? true) };
    case "back": {
      const prev = state.back[state.back.length - 1];
      if (!prev) return state;
      return { ...state, focus: prev, back: state.back.slice(0, -1), rightOpen: true };
    }
    case "setCofactorMode":
      return { ...state, cofactorMode: action.mode, layoutNonce: state.layoutNonce + 1 };
    case "setPreferRu":
      return { ...state, preferRu: action.value };
    case "setQuiz":
      return { ...state, quizMode: action.value };
    case "setDetailMode":
      return { ...state, detailMode: action.mode };
    case "setLayout":
      return { ...state, layout: action.layout, layoutNonce: state.layoutNonce + 1, expandAnchor: undefined };
    case "relayout":
      return { ...state, layoutNonce: state.layoutNonce + 1, expandAnchor: undefined };
    case "resetLayout":
      return { ...state, resetNonce: state.resetNonce + 1, mapPathwayFilter: null, fitNonce: state.fitNonce + 1 };
    case "fit":
      return { ...state, fitNonce: state.fitNonce + 1 };
    case "setRoute":
      return { ...state, activeRoute: action.route, activeRoutePath: 0 };
    case "selectRoutePath":
      return { ...state, activeRoutePath: action.index };
    case "setRouteEndpoint":
      return {
        ...state,
        [action.end === "from" ? "routeFrom" : "routeTo"]: action.value,
        ...(action.openPanel ? { leftTab: "route" as const, leftOpen: true } : {}),
      };
    case "setReview":
      return { ...state, review: action.review, quizMode: action.review ? true : false };
    case "swapRouteEndpoints":
      return { ...state, routeFrom: state.routeTo, routeTo: state.routeFrom };
    case "setLeftTab":
      return { ...state, leftTab: action.tab, leftOpen: true };
    case "setLeftOpen":
      return { ...state, leftOpen: action.value };
    case "setRightOpen":
      return { ...state, rightOpen: action.value };
    case "restore":
      return {
        ...state,
        ...action.patch,
        rightOpen: !!action.patch.focus,
        layoutNonce: state.layoutNonce + 1,
      };
    case "undoMap": {
      const prev = state.mapHistory[state.mapHistory.length - 1];
      if (!prev) return state;
      return {
        ...state,
        ...prev,
        mapHistory: state.mapHistory.slice(0, -1),
        mapPathwayFilter: null,
        activeRoute: prev.mapContext.kind === "route" ? state.activeRoute : null,
        layoutNonce: state.layoutNonce + 1,
        expandAnchor: undefined,
      };
    }
    case "setMapPathwayFilter":
      return { ...state, mapPathwayFilter: action.pathwayId };
    case "clearMap":
      return {
        ...state,
        mapHistory: pushHistory(state),
        mapPathwayFilter: null,
        visibleReactionIds: [],
        hiddenMetaboliteIds: [],
        mapContext: { kind: "empty", label: "" },
        activeRoute: null,
      };
  }
}

function focusPatch(state: AppState, ref: EntityRef | null, pushHistory: boolean): Partial<AppState> {
  if (sameRef(state.focus, ref)) return { rightOpen: ref !== null };
  const back = pushHistory && state.focus ? [...state.back, state.focus].slice(-40) : state.back;
  return { focus: ref, back, rightOpen: ref !== null };
}

export interface AppContextValue {
  index: MetaboIndex;
  searchIndex: SearchIndex;
  state: AppState;
  dispatch: React.Dispatch<Action>;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside <AppContext.Provider>");
  return ctx;
}
