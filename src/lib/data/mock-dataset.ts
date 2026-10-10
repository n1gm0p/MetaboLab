import type { Dataset, Metabolite, Participant, Reaction, SourceRef } from "@/lib/model/types";

/**
 * Small, hand-checked dataset: the 10 classical steps of glycolysis in the cytosol.
 * Used for tests and as an offline fallback when the generated dataset is unavailable.
 * Reaction ids mirror the corresponding Reactome reactions; reversibility follows the textbook
 * classification and is explicitly marked as a curated statement.
 */

const CYTOSOL = "GO:0005829";

const reactome = (id: string): SourceRef => ({
  db: "reactome",
  id,
  url: `https://reactome.org/content/detail/${id}`,
});
const chebi = (n: number): SourceRef => ({
  db: "chebi",
  id: `CHEBI:${n}`,
  url: `https://www.ebi.ac.uk/chebi/searchId.do?chebiId=CHEBI:${n}`,
});
const curated: SourceRef = { db: "curated", id: "textbook-reversibility", label: "Учебная классификация обратимости" };

function met(
  id: string,
  name: string,
  nameRu: string,
  abbreviation: string,
  chebiNum: number,
  formula: string,
  currency = false,
  synonyms: string[] = [],
): Metabolite {
  return {
    id,
    name,
    nameRu,
    abbreviation,
    synonyms,
    kind: "small-molecule",
    compartmentId: CYTOSOL,
    chebiId: `CHEBI:${chebiNum}`,
    formula,
    currency,
    sources: [chebi(chebiNum)],
  };
}

const p = (metaboliteId: string, stoichiometry = 1): Participant => ({ metaboliteId, stoichiometry });

export const mockMetabolites: Metabolite[] = [
  met("glc_c", "D-glucose", "D-глюкоза", "Glc", 4167, "C6H12O6", false, ["glucose", "dextrose"]),
  met("g6p_c", "D-glucose 6-phosphate", "глюкозо-6-фосфат", "G6P", 4170, "C6H13O9P"),
  met("f6p_c", "D-fructose 6-phosphate", "фруктозо-6-фосфат", "F6P", 15946, "C6H13O9P"),
  met("fbp_c", "D-fructose 1,6-bisphosphate", "фруктозо-1,6-бисфосфат", "F1,6BP", 16905, "C6H14O12P2"),
  met("dhap_c", "dihydroxyacetone phosphate", "дигидроксиацетонфосфат", "DHAP", 16108, "C3H7O6P"),
  met("ga3p_c", "D-glyceraldehyde 3-phosphate", "глицеральдегид-3-фосфат", "GA3P", 29052, "C3H7O6P"),
  met("bpg13_c", "3-phospho-D-glyceroyl phosphate", "1,3-бисфосфоглицерат", "1,3BPG", 16001, "C3H8O10P2"),
  met("pg3_c", "3-phospho-D-glycerate", "3-фосфоглицерат", "3PG", 17794, "C3H7O7P"),
  met("pg2_c", "2-phospho-D-glycerate", "2-фосфоглицерат", "2PG", 17835, "C3H7O7P"),
  met("pep_c", "phosphoenolpyruvate", "фосфоенолпируват", "PEP", 18021, "C3H5O6P"),
  met("pyr_c", "pyruvate", "пируват", "PYR", 32816, "C3H3O3-"),
  met("atp_c", "ATP", "АТФ", "ATP", 30616, "C10H12N5O13P3", true),
  met("adp_c", "ADP", "АДФ", "ADP", 456216, "C10H12N5O10P2", true),
  met("nad_c", "NAD+", "НАД+", "NAD+", 57540, "C21H26N7O14P2", true),
  met("nadh_c", "NADH", "НАДН", "NADH", 57945, "C21H27N7O14P2", true),
  met("pi_c", "orthophosphate", "ортофосфат", "Pi", 43474, "HO4P", true),
  met("h_c", "H+", "H+", "H+", 15378, "H", true),
  met("h2o_c", "water", "вода", "H2O", 15377, "H2O", true),
];

function rxn(
  id: string,
  name: string,
  nameRu: string,
  inputs: Participant[],
  outputs: Participant[],
  enzymeId: string,
  ec: string,
  reversible: boolean,
): Reaction {
  return {
    id,
    name,
    nameRu,
    inputs,
    outputs,
    reversible,
    enzymeIds: [enzymeId],
    ecNumbers: [ec],
    compartmentIds: [CYTOSOL],
    pathwayIds: ["R-HSA-70171"],
    regulation: [],
    category: "transition",
    isTransport: false,
    rheaIds: [],
    sources: [reactome(id), curated],
  };
}

export const mockReactions: Reaction[] = [
  rxn("R-HSA-70420", "Hexokinase phosphorylates glucose", "Фосфорилирование глюкозы гексокиназой",
    [p("glc_c"), p("atp_c")], [p("g6p_c"), p("adp_c")], "enz_hk", "2.7.1.1", false),
  rxn("R-HSA-70471", "GPI isomerizes G6P", "Изомеризация G6P фосфоглюкоизомеразой",
    [p("g6p_c")], [p("f6p_c")], "enz_gpi", "5.3.1.9", true),
  rxn("R-HSA-70467", "PFK phosphorylates F6P", "Фосфорилирование F6P фосфофруктокиназой-1",
    [p("f6p_c"), p("atp_c")], [p("fbp_c"), p("adp_c")], "enz_pfk", "2.7.1.11", false),
  rxn("R-HSA-71496", "Aldolase cleaves F1,6BP", "Расщепление F1,6BP альдолазой",
    [p("fbp_c")], [p("dhap_c"), p("ga3p_c")], "enz_aldo", "4.1.2.13", true),
  rxn("R-HSA-70454", "TPI isomerizes DHAP to GA3P", "Изомеризация DHAP триозофосфатизомеразой",
    [p("dhap_c")], [p("ga3p_c")], "enz_tpi", "5.3.1.1", true),
  rxn("R-HSA-70449", "GAPDH dehydrogenates GA3P", "Окисление GA3P глицеральдегид-3-фосфатдегидрогеназой",
    [p("ga3p_c"), p("nad_c"), p("pi_c")], [p("bpg13_c"), p("nadh_c"), p("h_c")], "enz_gapdh", "1.2.1.12", true),
  rxn("R-HSA-71850", "PGK dephosphorylates 1,3BPG", "Субстратное фосфорилирование фосфоглицераткиназой",
    [p("bpg13_c"), p("adp_c")], [p("pg3_c"), p("atp_c")], "enz_pgk", "2.7.2.3", true),
  rxn("R-HSA-71654", "PGAM isomerises 3PG to 2PG", "Изомеризация 3PG фосфоглицератмутазой",
    [p("pg3_c")], [p("pg2_c")], "enz_pgam", "5.4.2.11", true),
  rxn("R-HSA-71660", "Enolase dehydrates 2PG", "Дегидратация 2PG енолазой",
    [p("pg2_c")], [p("pep_c"), p("h2o_c")], "enz_eno", "4.2.1.11", true),
  rxn("R-HSA-71670", "Pyruvate kinase dephosphorylates PEP", "Перенос фосфата с PEP пируваткиназой",
    [p("pep_c"), p("adp_c"), p("h_c")], [p("pyr_c"), p("atp_c")], "enz_pk", "2.7.1.40", false),
];

const enzyme = (id: string, name: string, nameRu: string, genes: string[], ec: string, reactionId: string) => ({
  id,
  name,
  nameRu,
  synonyms: [],
  genes,
  ecNumbers: [ec],
  cofactorIds: [],
  reactionIds: [reactionId],
  compartmentIds: [CYTOSOL],
  sources: [reactome(reactionId)],
});

export const mockDataset: Dataset = {
  meta: {
    title: "Демонстрационный набор: гликолиз",
    generatedAt: "2026-10-11T00:00:00.000Z",
    isMock: true,
    sources: [
      {
        name: "Reactome",
        license: "CC BY 4.0",
        url: "https://reactome.org",
        usage: "Идентификаторы реакций; набор составлен вручную",
      },
    ],
    coverage: { rootPathwayIds: ["R-HSA-70171"], note: "10 реакций гликолиза в цитозоле. Демонстрационный набор." },
    detailShards: 0,
  },
  compartments: [{ id: CYTOSOL, name: "cytosol", nameRu: "цитозоль" }],
  metabolites: mockMetabolites,
  reactions: mockReactions,
  enzymes: [
    enzyme("enz_hk", "hexokinase", "гексокиназа", ["HK1", "HK2", "HK3", "GCK"], "2.7.1.1", "R-HSA-70420"),
    enzyme("enz_gpi", "glucose-6-phosphate isomerase", "глюкозо-6-фосфатизомераза", ["GPI"], "5.3.1.9", "R-HSA-70471"),
    enzyme("enz_pfk", "6-phosphofructokinase", "фосфофруктокиназа-1", ["PFKL", "PFKM", "PFKP"], "2.7.1.11", "R-HSA-70467"),
    enzyme("enz_aldo", "fructose-bisphosphate aldolase", "альдолаза", ["ALDOA", "ALDOB", "ALDOC"], "4.1.2.13", "R-HSA-71496"),
    enzyme("enz_tpi", "triosephosphate isomerase", "триозофосфатизомераза", ["TPI1"], "5.3.1.1", "R-HSA-70454"),
    enzyme("enz_gapdh", "glyceraldehyde-3-phosphate dehydrogenase", "глицеральдегид-3-фосфатдегидрогеназа", ["GAPDH"], "1.2.1.12", "R-HSA-70449"),
    enzyme("enz_pgk", "phosphoglycerate kinase", "фосфоглицераткиназа", ["PGK1", "PGK2"], "2.7.2.3", "R-HSA-71850"),
    enzyme("enz_pgam", "phosphoglycerate mutase", "фосфоглицератмутаза", ["PGAM1", "PGAM2"], "5.4.2.11", "R-HSA-71654"),
    enzyme("enz_eno", "enolase", "енолаза", ["ENO1", "ENO2", "ENO3"], "4.2.1.11", "R-HSA-71660"),
    enzyme("enz_pk", "pyruvate kinase", "пируваткиназа", ["PKM", "PKLR"], "2.7.1.40", "R-HSA-71670"),
  ],
  pathways: [
    {
      id: "R-HSA-70171",
      name: "Glycolysis",
      nameRu: "Гликолиз",
      reactionIds: mockReactions.map((r) => r.id),
      subpathwayIds: [],
      parentIds: [],
      sources: [reactome("R-HSA-70171")],
    },
  ],
};
