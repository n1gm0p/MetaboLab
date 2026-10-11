import { describe, expect, it } from "vitest";
import { explainImbalance, reviewDataset, summarizeReview, type ManualDecision, type SourceVerification } from "@/lib/audit/review";
import { parseFormula } from "@/lib/audit/audit";
import { MATRIX, dataset, met, rxn } from "./fixtures";

describe("audit review rules", () => {
  it("treats non-element symbols in formulas as generic (regression: 'H2A' was parsed as an element)", () => {
    expect(parseFormula("H2A")).toBeNull();
    expect(parseFormula("A")).toBeNull();
    expect(parseFormula("Fe2S2")).toEqual({ Fe: 2, S: 2 });
  });

  it("explains imbalances that equal a whole number of a small species", () => {
    expect(explainImbalance({ C: 1, O: 2 })).toMatch(/1 × CO₂/);
    expect(explainImbalance({ C: 42, N: 14, O: 34, P: 6 })).toMatch(/2 × НАДФ/);
    expect(explainImbalance({ C: 1, O: 1 })).toMatch(/формальдегид/);
    expect(explainImbalance({ O: -4, P: -1 })).toMatch(/Pi/);
    expect(explainImbalance({ C: 3, N: 1 })).toBeNull();
  });

  it("does not claim water when only oxygen differs (could be O2 or a wrong coefficient)", () => {
    const text = explainImbalance({ O: -6 })!;
    expect(text).toMatch(/H₂O\/O₂/);
    expect(text).toMatch(/коэффициент/);
  });

  const ds = dataset(
    [
      met("a", { formula: "C3H4O3" }),
      met("b", { formula: "C3H6O3" }),
      met("c", { formula: "C2H4O2" }),
      met("m", { compartmentId: MATRIX, formula: "C2H4O2" }),
      met("cplx", { kind: "complex" }),
    ],
    [
      rxn("UNB", [["a"]], [["c"]], { enzymeIds: ["E"], ecNumbers: ["1.1.1.1"] }), // C3H4O3 -> C2H4O2: C1 O1 short
      rxn("BOX", [["a"]], [["c"]], { category: "black-box", enzymeIds: ["E"], ecNumbers: ["1.1.1.1"] }),
      rxn("TR", [["c"]], [["m"]], { isTransport: true, enzymeIds: ["T"], ecNumbers: [] }),
      rxn("ODD", [["a"]], [["m"]], { enzymeIds: ["E"], ecNumbers: ["1.1.1.1"] }),
      rxn("SPONT", [["a"]], [["b"]]),
      rxn("BIND", [["a"], ["cplx"]], [["cplx"]], { category: "binding" }),
    ],
  );
  const verification = (ok = true): SourceVerification => ({
    verifiedAt: "t",
    datasetGeneratedAt: ds.meta.generatedAt,
    reactions: ds.reactions.map((r) => ({
      id: r.id,
      found: true,
      matches: { inputs: ok, outputs: ok, compartments: ok, catalystCount: ok, ecNumbers: ok },
    })),
  });
  const find = (items: ReturnType<typeof reviewDataset>, cat: string, id: string) => items.find((i) => i.category === cat && i.recordId === id);

  it("is 'unreviewed' without a source check and 'checked' with one", () => {
    expect(find(reviewDataset(ds), "rxn-unbalanced", "UNB")?.status).toBe("unreviewed");
    const it2 = find(reviewDataset(ds, verification()), "rxn-unbalanced", "UNB")!;
    expect(it2.status).toBe("checked");
    expect(it2.needsExpert).toBe(true);
    expect(it2.explanation).toMatch(/формальдегид/);
  });

  it("reports a mismatch with the source as a confirmed (import) error", () => {
    expect(find(reviewDataset(ds, verification(false)), "rxn-unbalanced", "UNB")?.status).toBe("confirmed-error");
  });

  it("accepts lumped events, transports and non-catalytic events as exceptions", () => {
    const items = reviewDataset(ds, verification());
    expect(find(items, "rxn-unbalanced", "BOX")?.status).toBe("accepted-exception");
    expect(find(items, "rxn-compartment-mismatch", "TR")?.status).toBe("accepted-exception");
    expect(find(items, "rxn-no-catalyst", "BIND")?.status).toBe("accepted-exception");
    // an uncatalysed chemical conversion is not an error, but it is not waved through either
    expect(find(items, "rxn-no-catalyst", "SPONT")?.status).toBe("checked");
    // a small molecule outside the event compartment without transport needs interpretation
    expect(find(items, "rxn-compartment-mismatch", "ODD")?.needsExpert).toBe(true);
    // a complex on both sides is a carrier/catalyst representation
    expect(find(items, "same-both-sides", "BIND")?.status).toBe("accepted-exception");
  });

  it("ignores a source check made for another dataset version", () => {
    const stale = { ...verification(), datasetGeneratedAt: "other" };
    expect(find(reviewDataset(ds, stale), "rxn-unbalanced", "UNB")?.status).toBe("unreviewed");
  });

  it("applies documented manual decisions on top of rules", () => {
    const decision: ManualDecision = {
      category: "rxn-unbalanced",
      recordId: "UNB",
      status: "checked",
      needsExpert: true,
      suspectedSourceIssue: true,
      explanation: "вероятна ошибка источника",
      reviewer: "test",
      date: "2026-01-01",
    };
    const it3 = find(reviewDataset(ds, verification(), [decision]), "rxn-unbalanced", "UNB")!;
    expect(it3).toMatchObject({ basis: "manual", suspectedSourceIssue: true });
    expect(it3.explanation).toContain("test");
    const sum = summarizeReview(reviewDataset(ds, verification(), [decision]));
    expect(sum["rxn-unbalanced"]?.suspectedSourceIssue).toBe(1);
  });
});
