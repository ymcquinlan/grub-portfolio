/**
 * Shared TypeScript types for RxNav API responses and tool output formats.
 *
 * The RxNav REST APIs (RxNorm, RxClass, RxTerms) return JSON with inconsistent
 * casing and a habit of omitting fields (or returning empty objects) rather than
 * using nulls. These interfaces model the "happy path" shapes; all outer objects
 * are treated as possibly-absent throughout services/tools code.
 */

export enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json",
}

/** A single RxNorm concept property block (from allProperties / properties). */
export interface RxNormPropertyItem {
  propName: string;
  propValue: string;
}

export interface RxNormConceptProperty {
  rxcui: string;
  name: string;
  synonym?: string;
  tty: string;
  language?: string;
  suppress?: string;
  umlscui?: string;
  psn?: string;
}

export interface RxNormConceptGroup {
  tty?: string;
  conceptProperties?: RxNormConceptProperty[];
}

export interface RxNormDrugGroup {
  name?: string;
  conceptGroup?: RxNormConceptGroup[];
}

export interface ApproximateCandidate {
  rxcui: string;
  rxaui?: string;
  score: string;
  rank: string;
  name?: string;
  source?: string;
}

export interface RxClassMinConcept {
  rxcui: string;
  name: string;
  tty: string;
}

export interface RxClassItem {
  classId: string;
  className: string;
  classType: string;
}

export interface RxClassDrugInfo {
  minConcept: RxClassMinConcept;
  rxclassMinConceptItem: RxClassItem;
  rela?: string;
  relaSource?: string;
}

export interface RxTermsProperties {
  rxcui?: string;
  brandName?: string;
  displayName?: string;
  synonym?: string;
  fullName?: string;
  fullGenericName?: string;
  strength?: string;
  rxtermsDoseForm?: string;
  route?: string;
  termType?: string;
  genericRxcui?: string;
  rxnormDoseForm?: string;
  suppress?: string;
}
