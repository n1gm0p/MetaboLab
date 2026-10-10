import { z } from "zod";
import type { Dataset, RecordDetails } from "./types";

const sourceRef = z.object({
  db: z.enum(["reactome", "rhea", "chebi", "kegg", "pubchem", "go", "pubmed", "ec", "uniprot", "curated"]),
  id: z.string(),
  url: z.string().optional(),
  label: z.string().optional(),
});

const compartment = z.object({ id: z.string(), name: z.string(), nameRu: z.string().optional() });

const metabolite = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  nameRu: z.string().optional(),
  abbreviation: z.string().optional(),
  synonyms: z.array(z.string()),
  kind: z.enum(["small-molecule", "set", "macromolecule", "complex", "polymer", "other"]),
  compartmentId: z.string(),
  chebiId: z.string().optional(),
  formula: z.string().optional(),
  keggId: z.string().optional(),
  currency: z.boolean(),
  sources: z.array(sourceRef),
});

const participant = z.object({ metaboliteId: z.string(), stoichiometry: z.number().positive() });

const regulation = z.object({
  type: z.enum(["positive", "negative", "requirement"]),
  regulatorId: z.string().optional(),
  regulatorName: z.string(),
  sources: z.array(sourceRef),
});

const reaction = z.object({
  id: z.string().min(1),
  name: z.string(),
  nameRu: z.string().optional(),
  inputs: z.array(participant),
  outputs: z.array(participant),
  reversible: z.boolean(),
  reverseReactionId: z.string().optional(),
  enzymeIds: z.array(z.string()),
  ecNumbers: z.array(z.string()),
  compartmentIds: z.array(z.string()),
  pathwayIds: z.array(z.string()),
  regulation: z.array(regulation),
  category: z.enum([
    "transition",
    "binding",
    "dissociation",
    "transport",
    "black-box",
    "polymerisation",
    "depolymerisation",
    "omitted",
    "uncertain",
  ]),
  isTransport: z.boolean(),
  rheaIds: z.array(z.string()),
  sources: z.array(sourceRef),
});

const enzyme = z.object({
  id: z.string(),
  name: z.string(),
  nameRu: z.string().optional(),
  synonyms: z.array(z.string()),
  genes: z.array(z.string()),
  ecNumbers: z.array(z.string()),
  activity: z.string().optional(),
  cofactorIds: z.array(z.string()),
  reactionIds: z.array(z.string()),
  compartmentIds: z.array(z.string()),
  sources: z.array(sourceRef),
});

const pathway = z.object({
  id: z.string(),
  name: z.string(),
  nameRu: z.string().optional(),
  reactionIds: z.array(z.string()),
  subpathwayIds: z.array(z.string()),
  parentIds: z.array(z.string()),
  sources: z.array(sourceRef),
});

export const datasetSchema = z.object({
  meta: z.object({
    title: z.string(),
    generatedAt: z.string(),
    isMock: z.boolean(),
    sources: z.array(
      z.object({
        name: z.string(),
        version: z.string().optional(),
        license: z.string(),
        url: z.string(),
        usage: z.string(),
      }),
    ),
    coverage: z.object({ rootPathwayIds: z.array(z.string()), note: z.string() }),
    detailShards: z.number().int().nonnegative(),
  }),
  compartments: z.array(compartment),
  metabolites: z.array(metabolite),
  reactions: z.array(reaction),
  enzymes: z.array(enzyme),
  pathways: z.array(pathway),
});

export const recordDetailsSchema = z.object({
  id: z.string(),
  summary: z.string().optional(),
  summarySource: sourceRef.optional(),
  smiles: z.string().optional(),
  inchiKey: z.string().optional(),
  definition: z.string().optional(),
  literature: z.array(
    z.object({
      title: z.string(),
      journal: z.string().optional(),
      year: z.number().optional(),
      pubmedId: z.string().optional(),
      url: z.string().optional(),
    }),
  ),
});

export const detailShardSchema = z.record(z.string(), recordDetailsSchema);

// Compile-time guarantee that the schema and the TS model stay in sync.
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const _datasetInSync: Equals<z.infer<typeof datasetSchema>, Dataset> = true;
const _detailsInSync: Equals<z.infer<typeof recordDetailsSchema>, RecordDetails> = true;
void _datasetInSync;
void _detailsInSync;

export interface IntegrityIssue {
  kind: "dangling-reference" | "duplicate-id" | "empty-reaction";
  message: string;
}

/** Referential integrity checks that a structural schema cannot express. */
export function checkIntegrity(ds: Dataset): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const ids = (arr: { id: string }[], label: string) => {
    const set = new Set<string>();
    for (const x of arr) {
      if (set.has(x.id)) issues.push({ kind: "duplicate-id", message: `${label} ${x.id}` });
      set.add(x.id);
    }
    return set;
  };
  const mets = ids(ds.metabolites, "metabolite");
  const rxns = ids(ds.reactions, "reaction");
  const enz = ids(ds.enzymes, "enzyme");
  const pws = ids(ds.pathways, "pathway");
  const comps = ids(ds.compartments, "compartment");

  for (const m of ds.metabolites) {
    if (!comps.has(m.compartmentId))
      issues.push({ kind: "dangling-reference", message: `metabolite ${m.id} -> compartment ${m.compartmentId}` });
  }
  for (const r of ds.reactions) {
    if (r.inputs.length === 0 && r.outputs.length === 0)
      issues.push({ kind: "empty-reaction", message: `reaction ${r.id} has no participants` });
    for (const p of [...r.inputs, ...r.outputs])
      if (!mets.has(p.metaboliteId))
        issues.push({ kind: "dangling-reference", message: `reaction ${r.id} -> metabolite ${p.metaboliteId}` });
    for (const e of r.enzymeIds)
      if (!enz.has(e)) issues.push({ kind: "dangling-reference", message: `reaction ${r.id} -> enzyme ${e}` });
    for (const p of r.pathwayIds)
      if (!pws.has(p)) issues.push({ kind: "dangling-reference", message: `reaction ${r.id} -> pathway ${p}` });
  }
  for (const p of ds.pathways) {
    for (const r of p.reactionIds)
      if (!rxns.has(r)) issues.push({ kind: "dangling-reference", message: `pathway ${p.id} -> reaction ${r}` });
    for (const s of p.subpathwayIds)
      if (!pws.has(s)) issues.push({ kind: "dangling-reference", message: `pathway ${p.id} -> subpathway ${s}` });
  }
  return issues;
}
