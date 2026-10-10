import { describe, expect, it } from "vitest";
import { buildIndex, directionalReactions } from "@/lib/data/metabo-index";
import { buildGraph, metaboliteNodeId, neighborhoodReactions, reactionNodeId } from "@/lib/graph/build";
import { mockDataset } from "@/lib/data/mock-dataset";
import { checkIntegrity, datasetSchema } from "@/lib/model/schema";
import { dataset, met, rxn } from "./fixtures";

describe("bipartite graph construction", () => {
  // A + 2 B + ATP -> C + D (multi-substrate, multi-product, stoichiometry 2)
  const ds = dataset(
    [met("A"), met("B"), met("C"), met("D"), met("ATP", { currency: true, abbreviation: "ATP" })],
    [rxn("R1", [["A"], ["B", 2], ["ATP"]], [["C"], ["D"]]), rxn("R2", [["C"], ["ATP"]], [["A"]])],
  );
  const index = buildIndex(ds);

  it("creates one reaction node and an edge for every participant", () => {
    const g = buildGraph(index, ["R1"], { cofactorMode: "shared", preferRu: false });
    const rNode = reactionNodeId("R1");
    expect(g.nodes.filter((n) => n.kind === "reaction")).toHaveLength(1);
    expect(g.nodes.filter((n) => n.kind === "metabolite")).toHaveLength(5);
    const incoming = g.edges.filter((e) => e.target === rNode);
    const outgoing = g.edges.filter((e) => e.source === rNode);
    expect(incoming.map((e) => e.metaboliteId).sort()).toEqual(["A", "ATP", "B"]);
    expect(outgoing.map((e) => e.metaboliteId).sort()).toEqual(["C", "D"]);
    expect(incoming.find((e) => e.metaboliteId === "B")?.stoichiometry).toBe(2);
  });

  it("never creates direct metabolite-to-metabolite edges", () => {
    const g = buildGraph(index, ["R1", "R2"], { cofactorMode: "shared", preferRu: false });
    const kind = new Map(g.nodes.map((n) => [n.id, n.kind]));
    for (const e of g.edges) expect(kind.get(e.source)).not.toBe(kind.get(e.target));
  });

  it("clones currency metabolites per reaction in duplicate mode and drops them in hide mode", () => {
    const dup = buildGraph(index, ["R1", "R2"], { cofactorMode: "duplicate", preferRu: false });
    expect(dup.nodes.filter((n) => n.refId === "ATP")).toHaveLength(2);
    expect(dup.nodes.some((n) => n.id === metaboliteNodeId("ATP"))).toBe(false);
    const shared = buildGraph(index, ["R1", "R2"], { cofactorMode: "shared", preferRu: false });
    expect(shared.nodes.filter((n) => n.refId === "ATP")).toHaveLength(1);
    const hidden = buildGraph(index, ["R1", "R2"], { cofactorMode: "hide", preferRu: false });
    expect(hidden.nodes.some((n) => n.refId === "ATP")).toBe(false);
  });

  it("hides metabolites chosen by the user", () => {
    const g = buildGraph(index, ["R1"], { cofactorMode: "shared", preferRu: false, hiddenMetaboliteIds: new Set(["D"]) });
    expect(g.nodes.some((n) => n.refId === "D")).toBe(false);
    expect(g.edges.some((e) => e.metaboliteId === "D")).toBe(false);
  });

  it("separates producing and consuming reactions of a metabolite", () => {
    expect(directionalReactions(index, "A")).toEqual({ incoming: ["R2"], outgoing: ["R1"] });
    expect(directionalReactions(index, "C")).toEqual({ incoming: ["R1"], outgoing: ["R2"] });
  });

  it("does not expand neighbourhoods through currency metabolites", () => {
    const ds2 = dataset(
      [met("X"), met("Y"), met("Z"), met("W"), met("ATP", { currency: true })],
      [rxn("R1", [["X"], ["ATP"]], [["Y"]]), rxn("R9", [["Z"], ["ATP"]], [["W"]])],
    );
    const idx = buildIndex(ds2);
    expect(neighborhoodReactions(idx, "X", 3).sort()).toEqual(["R1"]);
  });
});

describe("mock dataset", () => {
  it("passes schema and integrity checks", () => {
    expect(datasetSchema.safeParse(mockDataset).success).toBe(true);
    expect(checkIntegrity(mockDataset)).toEqual([]);
  });
});
