import { describe, expect, it } from "vitest";
import { initialState, reducer, type AppState } from "@/components/state/app-state";

const show = (s: AppState, ids: string[], label: string) =>
  reducer(s, { type: "showReactions", reactionIds: ids, context: { kind: "pathway", label } });

describe("map history", () => {
  it("returns to the previous map view", () => {
    let s = show(initialState, ["R1", "R2"], "A");
    s = show(s, ["R3"], "B");
    s = reducer(s, { type: "addReactions", reactionIds: ["R4"] });
    expect(s.visibleReactionIds).toEqual(["R3", "R4"]);
    s = reducer(s, { type: "undoMap" });
    expect(s.visibleReactionIds).toEqual(["R3"]);
    s = reducer(s, { type: "undoMap" });
    expect(s.visibleReactionIds).toEqual(["R1", "R2"]);
    expect(s.mapContext.label).toBe("A");
    expect(reducer(s, { type: "undoMap" })).toBe(s); // nothing left: no-op
  });

  it("can restore a cleared map and resets the pathway filter on a new view", () => {
    let s = show(initialState, ["R1"], "A");
    s = reducer(s, { type: "setMapPathwayFilter", pathwayId: "P" });
    s = reducer(s, { type: "clearMap" });
    expect(s.visibleReactionIds).toEqual([]);
    s = reducer(s, { type: "undoMap" });
    expect(s.visibleReactionIds).toEqual(["R1"]);
    expect(s.mapPathwayFilter).toBeNull();
  });

  it("review of saved cards switches self-check on and off", () => {
    let s = reducer(initialState, { type: "setReview", review: { items: [{ type: "reaction", id: "R1" }], i: 0 } });
    expect(s.quizMode).toBe(true);
    s = reducer(s, { type: "setReview", review: null });
    expect(s.quizMode).toBe(false);
  });
});
