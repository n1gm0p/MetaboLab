"use client";

import { useMemo } from "react";
import { neighborhoodReactions } from "@/lib/graph/build";
import type { EntityRef } from "@/lib/model/types";
import { useApp } from "./app-state";

/** Pathways larger than this are not drawn at once — the user drills down into sub-pathways. */
export const MAX_REACTIONS_ON_MAP = 450;

export function useNavigator() {
  const { index, state, dispatch } = useApp();
  const visible = useMemo(() => new Set(state.visibleReactionIds), [state.visibleReactionIds]);

  return useMemo(() => {
    const isMetaboliteOnMap = (id: string) =>
      [...(index.consumedBy.get(id) ?? []), ...(index.producedBy.get(id) ?? [])].some((r) => visible.has(r));

    const nameOf = (ref: EntityRef) => {
      const o =
        ref.type === "metabolite"
          ? index.metabolites.get(ref.id)
          : ref.type === "reaction"
            ? index.reactions.get(ref.id)
            : ref.type === "enzyme"
              ? index.enzymes.get(ref.id)
              : index.pathways.get(ref.id);
      return o ? (o.nameRu ?? o.name) : ref.id;
    };

    const openPathway = (id: string) => {
      const rids = index.pathwayReactionsDeep.get(id) ?? [];
      const ref: EntityRef = { type: "pathway", id };
      if (rids.length === 0 || rids.length > MAX_REACTIONS_ON_MAP) {
        dispatch({ type: "focus", ref });
        return;
      }
      dispatch({
        type: "showReactions",
        reactionIds: rids,
        context: { kind: "pathway", label: nameOf(ref), refId: id },
        layout: "hierarchical",
        focus: ref,
      });
    };

    const showNeighborhood = (metaboliteId: string) => {
      const ref: EntityRef = { type: "metabolite", id: metaboliteId };
      dispatch({
        type: "showReactions",
        reactionIds: neighborhoodReactions(index, metaboliteId, 1),
        context: { kind: "neighborhood", label: `Окрестность: ${nameOf(ref)}`, refId: metaboliteId },
        layout: "organic",
        focus: ref,
      });
    };

    const expandMetabolite = (metaboliteId: string) => {
      const rids = neighborhoodReactions(index, metaboliteId, 1);
      if (state.visibleReactionIds.length === 0) {
        showNeighborhood(metaboliteId);
        return;
      }
      dispatch({ type: "addReactions", reactionIds: rids, anchor: `m:${metaboliteId}` });
    };

    /** Open any entity: shows its card and makes sure it is visible on the map. */
    const open = (ref: EntityRef) => {
      switch (ref.type) {
        case "pathway":
          openPathway(ref.id);
          return;
        case "metabolite":
          if (!isMetaboliteOnMap(ref.id)) {
            if (state.visibleReactionIds.length === 0 || state.mapContext.kind === "neighborhood") showNeighborhood(ref.id);
            else dispatch({ type: "addReactions", reactionIds: neighborhoodReactions(index, ref.id, 1) });
          }
          dispatch({ type: "focus", ref });
          return;
        case "reaction":
          if (!visible.has(ref.id)) {
            if (state.visibleReactionIds.length === 0)
              dispatch({
                type: "showReactions",
                reactionIds: [ref.id],
                context: { kind: "custom", label: nameOf(ref) },
                layout: "organic",
              });
            else dispatch({ type: "addReactions", reactionIds: [ref.id] });
          }
          dispatch({ type: "focus", ref });
          return;
        case "enzyme": {
          const e = index.enzymes.get(ref.id);
          const missing = (e?.reactionIds ?? []).filter((r) => !visible.has(r));
          if (missing.length && e) {
            if (state.visibleReactionIds.length === 0)
              dispatch({
                type: "showReactions",
                reactionIds: e.reactionIds.slice(0, MAX_REACTIONS_ON_MAP),
                context: { kind: "custom", label: nameOf(ref) },
                layout: "organic",
              });
            else dispatch({ type: "addReactions", reactionIds: missing.slice(0, 60) });
          }
          dispatch({ type: "focus", ref });
          return;
        }
      }
    };

    /** Show the card only, without touching the map. */
    const inspect = (ref: EntityRef) => dispatch({ type: "focus", ref });

    return { open, inspect, openPathway, showNeighborhood, expandMetabolite, isMetaboliteOnMap, nameOf };
  }, [index, dispatch, visible, state.visibleReactionIds.length, state.mapContext.kind]);
}
