import type { Dataset, Metabolite, Reaction } from "@/lib/model/types";

export const CYTOSOL = "GO:0005829";
export const MATRIX = "GO:0005759";

export function met(id: string, opts: Partial<Metabolite> = {}): Metabolite {
  return { id, name: id, synonyms: [], kind: "small-molecule", compartmentId: CYTOSOL, currency: false, sources: [], ...opts };
}

export function rxn(
  id: string,
  inputs: [string, number?][],
  outputs: [string, number?][],
  opts: Partial<Reaction> = {},
): Reaction {
  return {
    id,
    name: id,
    inputs: inputs.map(([metaboliteId, s]) => ({ metaboliteId, stoichiometry: s ?? 1 })),
    outputs: outputs.map(([metaboliteId, s]) => ({ metaboliteId, stoichiometry: s ?? 1 })),
    reversible: false,
    enzymeIds: [],
    ecNumbers: [],
    compartmentIds: [CYTOSOL],
    pathwayIds: [],
    regulation: [],
    category: "transition",
    isTransport: false,
    rheaIds: [],
    sources: [],
    ...opts,
  };
}

export function dataset(metabolites: Metabolite[], reactions: Reaction[]): Dataset {
  return {
    meta: {
      title: "test",
      generatedAt: "",
      isMock: true,
      sources: [],
      coverage: { rootPathwayIds: [], note: "" },
      detailShards: 0,
    },
    compartments: [
      { id: CYTOSOL, name: "cytosol" },
      { id: MATRIX, name: "mitochondrial matrix" },
    ],
    metabolites,
    reactions,
    enzymes: [],
    pathways: [],
  };
}
