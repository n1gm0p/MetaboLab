"use client";

import { createContext, useContext } from "react";
import type { MetaboIndex } from "@/lib/data/metabo-index";
import type { CofactorMode } from "@/lib/graph/build";
import type { EntityRef } from "@/lib/model/types";
import type { SearchIndex } from "@/lib/search/search";
import type { RouteResult } from "@/lib/graph/route";

export type LeftTab = "pathways" | "route" | "library";
export type LayoutMode = "hierarchical" | "organic";

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

export interface AppState {
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
  layout: LayoutMode;
  layoutNonce: number;
  fitNonce: number;
  /** metabolite node id that was expanded last (layout anchors new nodes around it) */
  expandAnchor?: string;
  activeRoute: RouteResult | null;
  activeRoutePath: number;
  routeFrom: RouteEndpoint | null;
  routeTo: RouteEndpoint | null;
  leftTab: LeftTab;
  leftOpen: boolean;
  rightOpen: boolean;
}

export const initialState: AppState = {
  visibleReactionIds: [],
  hiddenMetaboliteIds: [],
  hiddenCompartmentIds: [],
  mapContext: { kind: "empty", label: "" },
  focus: null,
  back: [],
  cofactorMode: "duplicate",
  preferRu: true,
  quizMode: false,
  layout: "hierarchical",
  layoutNonce: 0,
  fitNonce: 0,
  activeRoute: null,
  activeRoutePath: 0,
  routeFrom: null,
  routeTo: null,
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
  | { type: "setLayout"; layout: LayoutMode }
  | { type: "relayout" }
  | { type: "fit" }
  | { type: "setRoute"; route: RouteResult | null }
  | { type: "selectRoutePath"; index: number }
  | { type: "setRouteEndpoint"; end: "from" | "to"; value: RouteEndpoint | null; openPanel?: boolean }
  | { type: "swapRouteEndpoints" }
  | { type: "setLeftTab"; tab: LeftTab }
  | { type: "setLeftOpen"; value: boolean }
  | { type: "setRightOpen"; value: boolean }
  | { type: "clearMap" };

const sameRef = (a: EntityRef | null, b: EntityRef | null) => !!a && !!b && a.type === b.type && a.id === b.id;

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "showReactions":
      return {
        ...state,
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
    case "setLayout":
      return { ...state, layout: action.layout, layoutNonce: state.layoutNonce + 1, expandAnchor: undefined };
    case "relayout":
      return { ...state, layoutNonce: state.layoutNonce + 1, expandAnchor: undefined };
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
    case "swapRouteEndpoints":
      return { ...state, routeFrom: state.routeTo, routeTo: state.routeFrom };
    case "setLeftTab":
      return { ...state, leftTab: action.tab, leftOpen: true };
    case "setLeftOpen":
      return { ...state, leftOpen: action.value };
    case "setRightOpen":
      return { ...state, rightOpen: action.value };
    case "clearMap":
      return {
        ...state,
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
