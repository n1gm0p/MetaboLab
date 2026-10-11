import { describe, expect, it } from "vitest";
import { buildIndex } from "@/lib/data/metabo-index";
import { carbonCount, findRoutes } from "@/lib/graph/route";
import { mockDataset } from "@/lib/data/mock-dataset";
import { CYTOSOL, MATRIX, dataset, met, rxn } from "./fixtures";

const strict = { mode: "strict" as const, k: 5, maxSteps: 20 };

describe("route search", () => {
  it("finds the glycolytic sequence glucose -> pyruvate in the mock data", () => {
    const index = buildIndex(mockDataset);
    const res = findRoutes(index, ["glc_c"], ["pyr_c"], strict);
    expect(res.paths.length).toBeGreaterThan(0);
    const best = res.paths[0]!;
    expect(best.metaboliteIds[0]).toBe("glc_c");
    expect(best.metaboliteIds.at(-1)).toBe("pyr_c");
    // HK, GPI, PFK, aldolase (-> GA3P), GAPDH, PGK, PGAM, enolase, PK
    expect(best.steps).toHaveLength(9);
    expect(best.metaboliteIds).not.toContain("atp_c");
  });

  it("respects reaction direction", () => {
    const ds = dataset([met("A"), met("B"), met("C")], [rxn("R1", [["A"]], [["B"]]), rxn("R2", [["B"]], [["C"]])]);
    const index = buildIndex(ds);
    expect(findRoutes(index, ["A"], ["C"], strict).paths).toHaveLength(1);
    expect(findRoutes(index, ["C"], ["A"], strict).paths).toHaveLength(0);
    // relaxed (topological) mode ignores direction
    expect(findRoutes(index, ["C"], ["A"], { ...strict, mode: "relaxed" }).paths).toHaveLength(1);
  });

  it("allows backward traversal only for reversible reactions", () => {
    const ds = dataset([met("A"), met("B")], [rxn("R1", [["A"]], [["B"]], { reversible: true })]);
    const res = findRoutes(buildIndex(ds), ["B"], ["A"], strict);
    expect(res.paths).toHaveLength(1);
    expect(res.paths[0]!.steps[0]!.direction).toBe("backward");
  });

  it("requires a transport reaction between compartments in strict mode", () => {
    const mets = [
      met("pyr_c", { chebiId: "CHEBI:1" }),
      met("pyr_m", { chebiId: "CHEBI:1", compartmentId: MATRIX }),
      met("accoa_m", { compartmentId: MATRIX }),
    ];
    const pdh = rxn("PDH", [["pyr_m"]], [["accoa_m"]], { compartmentIds: [MATRIX] });
    const noTransport = buildIndex(dataset(mets, [pdh]));
    expect(findRoutes(noTransport, ["pyr_c"], ["accoa_m"], strict).paths).toHaveLength(0);

    const relaxed = findRoutes(noTransport, ["pyr_c"], ["accoa_m"], { ...strict, mode: "relaxed" });
    expect(relaxed.paths).toHaveLength(1);

    const transport = rxn("MPC", [["pyr_c"]], [["pyr_m"]], { compartmentIds: [CYTOSOL, MATRIX], isTransport: true });
    const withTransport = buildIndex(dataset(mets, [pdh, transport]));
    const res = findRoutes(withTransport, ["pyr_c"], ["accoa_m"], strict);
    expect(res.paths[0]!.steps.map((s) => s.reactionId)).toEqual(["MPC", "PDH"]);
  });

  it("reports co-substrates of multi-substrate reactions", () => {
    const ds = dataset(
      [met("A"), met("B"), met("C"), met("H2O", { currency: true })],
      [rxn("R1", [["A"], ["B"], ["H2O"]], [["C"]])],
    );
    const step = findRoutes(buildIndex(ds), ["A"], ["C"], strict).paths[0]!.steps[0]!;
    expect(step.coSubstrates.map((p) => p.metaboliteId)).toEqual(["B"]);
  });

  it("returns a bounded number of loop-free routes around cycles", () => {
    // cycle A->B->C->A, exit C->D, shortcut A->C
    const ds = dataset(
      [met("A"), met("B"), met("C"), met("D")],
      [
        rxn("AB", [["A"]], [["B"]]),
        rxn("BC", [["B"]], [["C"]]),
        rxn("CA", [["C"]], [["A"]]),
        rxn("CD", [["C"]], [["D"]]),
        rxn("AC", [["A"]], [["C"]]),
      ],
    );
    const res = findRoutes(buildIndex(ds), ["A"], ["D"], { ...strict, k: 10 });
    expect(res.paths).toHaveLength(2);
    for (const p of res.paths) expect(new Set(p.metaboliteIds).size).toBe(p.metaboliteIds.length);
    expect(res.paths[0]!.steps.length).toBeLessThanOrEqual(res.paths[1]!.steps.length);
  });

  it("supports several start compartments (multi-source)", () => {
    const mets = [met("A_c", { chebiId: "CHEBI:9" }), met("A_m", { chebiId: "CHEBI:9", compartmentId: MATRIX }), met("B")];
    const ds = dataset(mets, [rxn("R", [["A_m"]], [["B"]])]);
    const res = findRoutes(buildIndex(ds), ["A_c", "A_m"], ["B"], strict);
    expect(res.paths[0]!.metaboliteIds).toEqual(["A_m", "B"]);
  });

  it("prefers explicit reactions over a lumped black-box shortcut", () => {
    const ds = dataset(
      [met("A"), met("B"), met("C"), met("D")],
      [
        rxn("BOX", [["A"]], [["D"]], { category: "black-box" }),
        rxn("AB", [["A"]], [["B"]]),
        rxn("BC", [["B"]], [["C"]]),
        rxn("CD", [["C"]], [["D"]]),
      ],
    );
    const res = findRoutes(buildIndex(ds), ["A"], ["D"], { ...strict, k: 2 });
    expect(res.paths[0]!.steps.map((s) => s.reactionId)).toEqual(["AB", "BC", "CD"]);
    expect(res.paths[1]!.steps.map((s) => s.reactionId)).toEqual(["BOX"]);
  });

  it("merges variants that differ only by isoenzyme reactions", () => {
    const ds = dataset(
      [met("A"), met("B")],
      [rxn("ISO1", [["A"]], [["B"]]), rxn("ISO2", [["A"]], [["B"]])],
    );
    const res = findRoutes(buildIndex(ds), ["A"], ["B"], { ...strict, k: 5 });
    expect(res.paths).toHaveLength(1);
  });

  it("pairs substrates and products of exchange reactions by carbon count (transamination)", () => {
    // Ala + 2-OG -> Pyr + Glu; also a direct (longer) way 2-OG -> X -> Pyr
    const ds = dataset(
      [
        met("ala", { formula: "C3H7NO2" }),
        met("akg", { formula: "C5H4O5" }),
        met("pyr", { formula: "C3H3O3" }),
        met("glu", { formula: "C5H8NO4" }),
      ],
      [rxn("ALT", [["ala"], ["akg"]], [["pyr"], ["glu"]])],
    );
    const res = findRoutes(buildIndex(ds), ["ala"], ["pyr"], strict);
    expect(res.paths[0]!.steps[0]!.coSubstrates.map((p) => p.metaboliteId)).toEqual(["akg"]);
    // the carbon-mismatched pairing is still possible, but only as a lower-ranked option
    const odd = findRoutes(buildIndex(ds), ["akg"], ["pyr"], strict);
    expect(odd.paths).toHaveLength(1);
  });

  it("reads carbon counts from Hill formulas", () => {
    expect(carbonCount("C6H12O6")).toBe(6);
    expect(carbonCount("CO2")).toBe(1);
    expect(carbonCount("HCl")).toBe(0);
    expect(carbonCount("CaCl2")).toBe(0);
    expect(carbonCount(undefined)).toBeUndefined();
  });
});
