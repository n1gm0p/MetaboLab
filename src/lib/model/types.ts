/**
 * MetaboMap domain model.
 *
 * Key principles:
 *  - A reaction is a hyperedge: N substrates -> M products with stoichiometry.
 *  - A metabolite is compartment-specific (glucose [cytosol] != glucose [extracellular]).
 *    The same chemical across compartments is linked by `chebiId`, never merged silently.
 *  - Every record carries its provenance (`sources`).
 */

export type SourceDb =
  | "reactome"
  | "rhea"
  | "chebi"
  | "kegg"
  | "pubchem"
  | "go"
  | "pubmed"
  | "ec"
  | "uniprot"
  | "curated";

export interface SourceRef {
  db: SourceDb;
  id: string;
  url?: string;
  label?: string;
}

export interface Compartment {
  id: string; // "GO:0005829"
  name: string;
  nameRu?: string;
}

/** What kind of physical entity a reaction participant is. */
export type ParticipantKind =
  | "small-molecule" // single chemical (ChEBI)
  | "set" // class of chemicals, e.g. "long-chain fatty acid"
  | "macromolecule" // protein / RNA participant
  | "complex" // complex with protein components
  | "polymer" // glycogen, etc.
  | "other";

export interface Metabolite {
  /** Compartment-specific id (Reactome physical entity stable id for real data). */
  id: string;
  name: string;
  nameRu?: string;
  /** Short label used on the map ("G6P"). */
  abbreviation?: string;
  synonyms: string[];
  kind: ParticipantKind;
  compartmentId: string;
  chebiId?: string; // "CHEBI:4167"
  formula?: string;
  keggId?: string;
  /** Curated: ubiquitous carrier/cofactor (ATP, NAD+, H2O...). Used for display & routing filters. */
  currency: boolean;
  sources: SourceRef[];
}

export interface Participant {
  metaboliteId: string;
  stoichiometry: number;
}

export type RegulationType = "positive" | "negative" | "requirement";

export interface Regulation {
  type: RegulationType;
  /** id of a Metabolite or Enzyme when known, otherwise only a name */
  regulatorId?: string;
  regulatorName: string;
  sources: SourceRef[];
}

export type ReactionCategory =
  | "transition"
  | "binding"
  | "dissociation"
  | "transport"
  | "black-box"
  | "polymerisation"
  | "depolymerisation"
  | "omitted"
  | "uncertain";

export interface Reaction {
  id: string;
  name: string;
  nameRu?: string;
  inputs: Participant[];
  outputs: Participant[];
  /**
   * Reactome models directions explicitly. `reversible` is true only when the source states it
   * (e.g. a linked reverse reaction exists). Unknown is treated as irreversible.
   */
  reversible: boolean;
  reverseReactionId?: string;
  enzymeIds: string[];
  ecNumbers: string[];
  compartmentIds: string[];
  pathwayIds: string[];
  regulation: Regulation[];
  category: ReactionCategory;
  /** true when participants span more than one compartment */
  isTransport: boolean;
  rheaIds: string[];
  sources: SourceRef[];
}

export interface Enzyme {
  id: string;
  name: string;
  nameRu?: string;
  /** Gene symbols / alternative names */
  synonyms: string[];
  genes: string[];
  ecNumbers: string[];
  /** GO molecular function of the catalyst activity */
  activity?: string;
  /** curated Russian name of the EC activity (not of the catalyst entity itself) */
  activityRu?: string;
  /** small-molecule components of the catalyst (e.g. Mg2+, FAD) — from source complex composition */
  cofactorIds: string[];
  reactionIds: string[];
  compartmentIds: string[];
  sources: SourceRef[];
}

export interface Pathway {
  id: string;
  name: string;
  nameRu?: string;
  /** Reactions directly contained (not recursive) */
  reactionIds: string[];
  subpathwayIds: string[];
  parentIds: string[];
  sources: SourceRef[];
}

export interface LiteratureRef {
  title: string;
  journal?: string;
  year?: number;
  pubmedId?: string;
  url?: string;
}

/** Heavy, lazily loaded details for a single record. */
export interface RecordDetails {
  id: string;
  /** Text summary as provided by the source (never generated). */
  summary?: string;
  summarySource?: SourceRef;
  smiles?: string;
  inchiKey?: string;
  definition?: string; // ChEBI definition
  literature: LiteratureRef[];
}

export interface DataSourceInfo {
  name: string;
  version?: string;
  license: string;
  url: string;
  usage: string;
}

export interface DatasetMeta {
  title: string;
  generatedAt: string;
  isMock: boolean;
  sources: DataSourceInfo[];
  coverage: {
    rootPathwayIds: string[];
    note: string;
  };
  detailShards: number;
}

export interface Dataset {
  meta: DatasetMeta;
  compartments: Compartment[];
  metabolites: Metabolite[];
  reactions: Reaction[];
  enzymes: Enzyme[];
  pathways: Pathway[];
}

export type EntityType = "metabolite" | "reaction" | "enzyme" | "pathway";

export interface EntityRef {
  type: EntityType;
  id: string;
}
