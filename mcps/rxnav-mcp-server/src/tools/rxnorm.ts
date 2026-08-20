/**
 * Tools wrapping the RxNorm REST API (drug name normalization, RxCUI lookup,
 * related concepts, NDC mapping). See:
 * https://lhncbc.nlm.nih.gov/RxNav/APIs/RxNormAPIs.html
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { rxnavGet, describeRxNavError } from "../services/rxnav-client.js";
import { buildResult, errorResult, renderTable, bullet } from "../services/format.js";
import { extractFirstArray, asStringList } from "../services/generic.js";
import { responseFormatField, rxcuiField } from "../schemas/common.js";
import { ResponseFormat } from "../types.js";
import type {
  RxNormDrugGroup,
  RxNormConceptProperty,
  ApproximateCandidate,
} from "../types.js";

export function registerRxNormTools(server: McpServer): void {
  // ---------------------------------------------------------------------
  // rxnav_find_rxcui
  // ---------------------------------------------------------------------
  const FindRxcuiInputSchema = z
    .object({
      name: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Exact drug name to resolve to RxCUI(s) — an ingredient, brand, clinical/branded dose form, or component, e.g. 'metformin' or 'Lipitor 10 MG Oral Tablet'. Mutually exclusive with id/id_type."
        ),
      search: z
        .enum(["exact", "normalized", "both"])
        .default("both")
        .describe(
          "Match strategy for `name`: 'exact' matches the string as-is, 'normalized' case/punctuation-insensitively normalizes first, 'both' tries exact then falls back to normalized (default: 'both')."
        ),
      id: z
        .string()
        .min(1)
        .optional()
        .describe("An external identifier value to resolve to RxCUI(s), used together with id_type. Mutually exclusive with name."),
      id_type: z
        .enum([
          "NDC",
          "UPC",
          "GCN_SEQNO",
          "HIC_SEQN",
          "SNOMEDCT",
          "SPL_SET_ID",
          "MMSL_CODE",
          "MESH",
          "VUID",
          "ATC",
          "NDDF",
          "GS",
        ])
        .optional()
        .describe("The type of the `id` value. Required together with `id`. Use rxnav_get_reference_data(type='id_types') for the full list RxNav accepts."),
      response_format: responseFormatField,
    })
    .strict();
  // NOTE: cross-field validation (name XOR id+id_type) is enforced in the
  // handler rather than via .refine() — wrapping a ZodObject in .refine()
  // turns it into a ZodEffects, which the MCP SDK cannot convert into a
  // JSON Schema with populated `properties`, leaving clients with no
  // visibility into the tool's parameters.
  type FindRxcuiInput = z.infer<typeof FindRxcuiInputSchema>;

  server.registerTool(
    "rxnav_find_rxcui",
    {
      title: "Find RxCUI by Drug Name or External ID",
      description: `Resolve a drug name (or an external identifier like an NDC, UPC, or SNOMED CT code) to one or more RxNorm Concept Unique Identifiers (RxCUIs).

This is normally the FIRST call in any RxNav workflow — almost every other tool in this server takes an rxcui as input. Only exact/near-exact name matches are found here; for misspelled or partial names use rxnav_get_approximate_match or rxnav_get_spelling_suggestions instead.

Args:
  - name (string, optional): Exact drug name, e.g. 'metformin', 'Lipitor 10 MG Oral Tablet'.
  - search ('exact' | 'normalized' | 'both'): Match strategy (default 'both').
  - id (string, optional): External identifier value (use with id_type).
  - id_type (enum, optional): Type of 'id', e.g. 'NDC', 'SNOMEDCT'.
  - response_format ('markdown' | 'json'): Output format (default 'markdown').

Returns: The list of matching RxCUIs with the resolved name.

Examples:
  - Use when: "What's the RxCUI for metformin?" -> { name: "metformin" }
  - Use when: "What RxNorm concept does NDC 00069420030 map to?" -> { id: "00069420030", id_type: "NDC" }
  - Don't use when: the spelling might be wrong (use rxnav_get_approximate_match instead).

Error Handling:
  - Returns "No RxCUI found" if there is no match — try rxnav_get_approximate_match for a fuzzy search.`,
      inputSchema: FindRxcuiInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: FindRxcuiInput) => {
      try {
        if (Boolean(params.name) === Boolean(params.id && params.id_type)) {
          return errorResult("Error: Provide either `name`, or both `id` and `id_type` — not neither, and not both.");
        }
        const searchMap = { exact: "0", normalized: "1", both: "2" } as const;
        const queryParams = params.name
          ? { name: params.name, search: searchMap[params.search] }
          : { idtype: params.id_type, id: params.id };

        const data = await rxnavGet<{ idGroup?: { name?: string; rxnormId?: string[] } }>(
          "rxcui",
          queryParams
        );
        const rxcuis = data.idGroup?.rxnormId ?? [];
        const resolvedName = data.idGroup?.name;

        if (rxcuis.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No RxCUI found for ${params.name ? `name '${params.name}'` : `${params.id_type} '${params.id}'`}. Try rxnav_get_approximate_match for a fuzzy/misspelled search, or rxnav_get_spelling_suggestions.`,
              },
            ],
          };
        }

        const structured = { query: params.name ?? params.id, resolved_name: resolvedName, rxcuis };
        return buildResult(params.response_format, structured, () => {
          const lines = [`# RxCUI Lookup: '${params.name ?? params.id}'`, ""];
          if (resolvedName) lines.push(`Resolved name: **${resolvedName}**`, "");
          lines.push(`Found ${rxcuis.length} RxCUI(s):`, "");
          rxcuis.forEach((r) => lines.push(`- ${r}`));
          return lines.join("\n");
        });
      } catch (error) {
        return errorResult(describeRxNavError(error, "finding an RxCUI"));
      }
    }
  );

  // ---------------------------------------------------------------------
  // rxnav_get_approximate_match
  // ---------------------------------------------------------------------
  const ApproxMatchInputSchema = z
    .object({
      term: z.string().min(1).describe("Free-text drug name to fuzzy-match, e.g. 'zocor 10 mg' or a misspelled name."),
      max_entries: z.number().int().min(1).max(100).default(20).describe("Maximum number of candidates to return (1-100, default 20)."),
      only_active: z.boolean().default(true).describe("If true, restrict candidates to currently active RxNorm concepts (default true)."),
      response_format: responseFormatField,
    })
    .strict();
  type ApproxMatchInput = z.infer<typeof ApproxMatchInputSchema>;

  server.registerTool(
    "rxnav_get_approximate_match",
    {
      title: "Fuzzy-Match a Drug Name to RxCUI Candidates",
      description: `Find RxNorm concepts that approximately match a free-text drug name or phrase, ranked by similarity score. Use this for messy input — free text pulled from a prescription, OCR, voice transcription, or a name you're not sure is spelled correctly — where rxnav_find_rxcui would return no exact match.

Args:
  - term (string): Free-text drug name/phrase to match, e.g. 'zocor 10 mg'.
  - max_entries (number): Max candidates to return, 1-100 (default 20).
  - only_active (boolean): Restrict to currently active concepts (default true).
  - response_format ('markdown' | 'json'): Output format (default 'markdown').

Returns: Ranked candidates with rxcui, name, term type, source, and similarity score (higher = better match).

Examples:
  - Use when: "Match this messy OCR string to a drug" -> { term: "amoxicilin 500mg cap" }
  - Don't use when: you already know the exact drug name (use rxnav_find_rxcui — it's faster and more precise).`,
      inputSchema: ApproxMatchInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: ApproxMatchInput) => {
      try {
        const data = await rxnavGet<{
          approximateGroup?: { inputTerm?: string; candidate?: ApproximateCandidate[] };
        }>("approximateTerm", {
          term: params.term,
          maxEntries: params.max_entries,
          option: params.only_active ? 1 : 0,
        });
        const candidates = data.approximateGroup?.candidate ?? [];

        if (candidates.length === 0) {
          return {
            content: [
              { type: "text" as const, text: `No approximate matches found for '${params.term}'. Try rxnav_get_spelling_suggestions or a shorter/simpler term.` },
            ],
          };
        }

        const structured = { term: params.term, candidates };
        return buildResult(params.response_format, structured, () =>
          renderTable(
            candidates.map((c) => ({
              rank: c.rank,
              score: c.score,
              rxcui: c.rxcui,
              name: c.name,
              source: c.source,
            })),
            `Approximate Matches for '${params.term}'`
          )
        );
      } catch (error) {
        return errorResult(describeRxNavError(error, "fuzzy-matching a drug name"));
      }
    }
  );

  // ---------------------------------------------------------------------
  // rxnav_get_spelling_suggestions
  // ---------------------------------------------------------------------
  const SpellingInputSchema = z
    .object({
      name: z.string().min(1).describe("Drug name to get spelling suggestions for, e.g. 'lipiter'."),
      response_format: responseFormatField,
    })
    .strict();
  type SpellingInput = z.infer<typeof SpellingInputSchema>;

  server.registerTool(
    "rxnav_get_spelling_suggestions",
    {
      title: "Get Drug Name Spelling Suggestions",
      description: `Return a list of RxNorm drug names spelled similarly to the given string. Lighter-weight than rxnav_get_approximate_match — it suggests corrected NAMES rather than scored RxCUI candidates, so pair it with rxnav_find_rxcui on the suggestion you pick.

Args:
  - name (string): Possibly-misspelled drug name, e.g. 'lipiter'.
  - response_format ('markdown' | 'json'): Output format (default 'markdown').

Returns: A list of suggested spellings.

Examples:
  - Use when: "Did the user mean Lipitor?" -> { name: "lipiter" }
  - Don't use when: you need ranked RxCUI candidates directly (use rxnav_get_approximate_match).`,
      inputSchema: SpellingInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: SpellingInput) => {
      try {
        const data = await rxnavGet<{ suggestionGroup?: { suggestionList?: { suggestion?: string[] } } }>(
          "spellingsuggestions",
          { name: params.name }
        );
        const suggestions = data.suggestionGroup?.suggestionList?.suggestion ?? [];

        if (suggestions.length === 0) {
          return { content: [{ type: "text" as const, text: `No spelling suggestions found for '${params.name}'.` }] };
        }

        const structured = { name: params.name, suggestions };
        return buildResult(params.response_format, structured, () =>
          [`# Spelling Suggestions for '${params.name}'`, "", ...suggestions.map((s) => `- ${s}`)].join("\n")
        );
      } catch (error) {
        return errorResult(describeRxNavError(error, "getting spelling suggestions"));
      }
    }
  );

  // ---------------------------------------------------------------------
  // rxnav_search_drugs
  // ---------------------------------------------------------------------
  const SearchDrugsInputSchema = z
    .object({
      name: z
        .string()
        .min(1)
        .describe("Ingredient, brand, clinical dose form, branded dose form, clinical drug component, or branded drug component name, e.g. 'ibuprofen' or 'Advil'."),
      include_prescribable_names: z
        .boolean()
        .default(false)
        .describe("If true, include each concept's Prescribable Name (psn) — the patient-friendly display form (default false)."),
      response_format: responseFormatField,
    })
    .strict();
  type SearchDrugsInput = z.infer<typeof SearchDrugsInputSchema>;

  server.registerTool(
    "rxnav_search_drugs",
    {
      title: "Search All Drug Products for a Name",
      description: `Find every RxNorm drug product/form/strength related to a given ingredient or brand name, grouped by term type (TTY) — e.g. all clinical drugs (SCD), branded drugs (SBD), generic packs (GPCK), branded packs (BPCK), etc. for 'ibuprofen'. This is the tool for "what strengths/forms/brands exist for X?" questions — more complete than rxnav_find_rxcui, which only resolves the exact string given.

Args:
  - name (string): Ingredient or brand name, e.g. 'ibuprofen'.
  - include_prescribable_names (boolean): Include patient-friendly display names (default false).
  - response_format ('markdown' | 'json'): Output format (default 'markdown').

Returns: Concepts grouped by term type (TTY), each with rxcui, name, and synonym.

Term type reference: IN=Ingredient, PIN=Precise Ingredient, MIN=Multiple Ingredients, SCD=Semantic Clinical Drug (generic, e.g. "ibuprofen 200 MG Oral Tablet"), SBD=Semantic Branded Drug, GPCK=Generic Pack, BPCK=Branded Pack, SCDF/SBDF=Dose Form, BN=Brand Name.

Examples:
  - Use when: "List all forms and strengths of ibuprofen" -> { name: "ibuprofen" }
  - Use when: "What products exist under the brand Advil?" -> { name: "Advil" }
  - Don't use when: you already have an rxcui and want its close relatives (use rxnav_get_related_concepts instead — it's scoped and faster).`,
      inputSchema: SearchDrugsInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: SearchDrugsInput) => {
      try {
        const data = await rxnavGet<{ drugGroup?: RxNormDrugGroup }>("drugs", {
          name: params.name,
          expand: params.include_prescribable_names ? "psn" : undefined,
        });
        const groups = data.drugGroup?.conceptGroup ?? [];
        const totalConcepts = groups.reduce((sum, g) => sum + (g.conceptProperties?.length ?? 0), 0);

        if (totalConcepts === 0) {
          return {
            content: [
              { type: "text" as const, text: `No drug products found for '${params.name}'. Try rxnav_get_approximate_match if the name might be misspelled.` },
            ],
          };
        }

        const structured = { name: params.name, concept_groups: groups };
        return buildResult(params.response_format, structured, () => {
          const lines = [`# Drug Products for '${params.name}'`, "", `${totalConcepts} concept(s) across ${groups.length} term type(s):`, ""];
          for (const group of groups) {
            if (!group.conceptProperties?.length) continue;
            lines.push(`## ${group.tty ?? "Unknown TTY"} (${group.conceptProperties.length})`, "");
            for (const c of group.conceptProperties) {
              lines.push(`- **${c.name}** (rxcui: ${c.rxcui})${c.psn ? ` — _${c.psn}_` : ""}`);
            }
            lines.push("");
          }
          return lines.join("\n");
        });
      } catch (error) {
        return errorResult(describeRxNavError(error, "searching drug products"));
      }
    }
  );

  // ---------------------------------------------------------------------
  // rxnav_get_concept_properties
  // ---------------------------------------------------------------------
  const ConceptPropsInputSchema = z
    .object({
      rxcui: rxcuiField,
      detail: z
        .enum(["basic", "all"])
        .default("basic")
        .describe("'basic' returns name/TTY/synonym/language/suppress; 'all' returns the full attribute dump (codes, atoms, and source-vocabulary attributes) (default 'basic')."),
      response_format: responseFormatField,
    })
    .strict();
  type ConceptPropsInput = z.infer<typeof ConceptPropsInputSchema>;

  server.registerTool(
    "rxnav_get_concept_properties",
    {
      title: "Get RxNorm Concept Properties",
      description: `Get descriptive properties for a single RxNorm concept identified by RxCUI — its canonical name, term type, synonym, language, and (with detail='all') the complete set of attributes and codes from underlying source vocabularies.

Args:
  - rxcui (string): RxNorm Concept Unique Identifier, e.g. '213269'.
  - detail ('basic' | 'all'): Level of detail (default 'basic').
  - response_format ('markdown' | 'json'): Output format (default 'markdown').

Returns: For 'basic': name, tty, synonym, language, suppress flag. For 'all': every property/code RxNorm has recorded for the concept.

Examples:
  - Use when: "What is RxCUI 213269?" -> { rxcui: "213269" }
  - Use when: "Give me every code and attribute recorded for this concept" -> { rxcui: "213269", detail: "all" }

Error Handling:
  - Returns "No concept found" if the RxCUI doesn't exist or has been retired — check rxnav_get_rxcui_history_status.`,
      inputSchema: ConceptPropsInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: ConceptPropsInput) => {
      try {
        if (params.detail === "basic") {
          const data = await rxnavGet<{ properties?: RxNormConceptProperty }>(`rxcui/${params.rxcui}/properties`);
          const props = data.properties;
          if (!props) {
            return { content: [{ type: "text" as const, text: `No concept found for rxcui '${params.rxcui}'.` }] };
          }
          return buildResult(params.response_format, { properties: props }, () =>
            [
              `# Concept Properties: rxcui ${params.rxcui}`,
              "",
              bullet("Name", props.name),
              bullet("Term Type (TTY)", props.tty),
              bullet("Synonym", props.synonym),
              bullet("Language", props.language),
              bullet("Suppressed", props.suppress),
            ].join("")
          );
        }

        const data = await rxnavGet<{ propConceptGroup?: { propConcept?: Array<{ propCategory: string; propName: string; propValue: string }> } }>(
          `rxcui/${params.rxcui}/allProperties`,
          { prop: "all" }
        );
        const items = data.propConceptGroup?.propConcept ?? [];
        if (items.length === 0) {
          return { content: [{ type: "text" as const, text: `No properties found for rxcui '${params.rxcui}'.` }] };
        }
        return buildResult(params.response_format, { properties: items }, () =>
          renderTable(items, `All Properties: rxcui ${params.rxcui}`)
        );
      } catch (error) {
        return errorResult(describeRxNavError(error, "getting concept properties"));
      }
    }
  );

  // ---------------------------------------------------------------------
  // rxnav_get_related_concepts
  // ---------------------------------------------------------------------
  const RelatedInputSchema = z
    .object({
      rxcui: rxcuiField,
      scope: z
        .enum(["direct_and_indirect", "term_types", "relationships"])
        .default("direct_and_indirect")
        .describe(
          "'direct_and_indirect' returns everything related at any distance (broadest, good default); 'term_types' filters to specific TTYs via `term_types`; 'relationships' filters to specific RxNorm relationships via `relationships` (default 'direct_and_indirect')."
        ),
      term_types: z
        .array(z.string())
        .optional()
        .describe("Term types to filter to when scope='term_types', e.g. ['SCD','SBD']. See rxnav_get_reference_data(type='term_types') for valid values."),
      relationships: z
        .array(z.string())
        .optional()
        .describe("RxNorm relationship names to filter to when scope='relationships', e.g. ['tradename_of','has_ingredient']. See rxnav_get_reference_data(type='rela_types') for valid values."),
      response_format: responseFormatField,
    })
    .strict();
  type RelatedInput = z.infer<typeof RelatedInputSchema>;

  server.registerTool(
    "rxnav_get_related_concepts",
    {
      title: "Get Concepts Related to an RxCUI",
      description: `Get RxNorm concepts related to a given RxCUI — e.g. the ingredient(s) of a branded drug, the brand names for an ingredient, or every dose form of a clinical drug. Three scopes: the full related-concept graph (default), filtered to specific term types, or filtered to specific named relationships.

Args:
  - rxcui (string): The starting RxNorm concept.
  - scope ('direct_and_indirect' | 'term_types' | 'relationships'): What to fetch (default 'direct_and_indirect').
  - term_types (string[], optional): Required when scope='term_types', e.g. ['SBD'] to get only branded drugs.
  - relationships (string[], optional): Required when scope='relationships', e.g. ['tradename_of'].
  - response_format ('markdown' | 'json'): Output format (default 'markdown').

Returns: Related concepts grouped by term type, each with rxcui and name.

Examples:
  - Use when: "What brand names exist for this ingredient?" -> { rxcui: "6809", scope: "term_types", term_types: ["BN"] }
  - Use when: "What's the full related-concept graph for this drug?" -> { rxcui: "213269", scope: "direct_and_indirect" }
  - Use when: "What is the tradename of this ingredient?" -> { rxcui: "6809", scope: "relationships", relationships: ["tradename_of"] }`,
      inputSchema: RelatedInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: RelatedInput) => {
      try {
        if (params.scope === "term_types" && !params.term_types?.length) {
          return errorResult("Error: `term_types` is required (and must be non-empty) when scope='term_types'.");
        }
        if (params.scope === "relationships" && !params.relationships?.length) {
          return errorResult("Error: `relationships` is required (and must be non-empty) when scope='relationships'.");
        }

        let path = `rxcui/${params.rxcui}/allrelated`;
        let queryParams: Record<string, string | undefined> = {};
        if (params.scope === "term_types") {
          path = `rxcui/${params.rxcui}/related`;
          queryParams = { tty: params.term_types!.join(" ") };
        } else if (params.scope === "relationships") {
          path = `rxcui/${params.rxcui}/related`;
          queryParams = { rela: params.relationships!.join(" ") };
        }

        const data = await rxnavGet<{
          allRelatedGroup?: { conceptGroup?: RxNormDrugGroup["conceptGroup"] };
          relatedGroup?: { conceptGroup?: RxNormDrugGroup["conceptGroup"] };
        }>(path, queryParams);
        const groups = data.allRelatedGroup?.conceptGroup ?? data.relatedGroup?.conceptGroup ?? [];
        const totalConcepts = groups.reduce((sum, g) => sum + (g.conceptProperties?.length ?? 0), 0);

        if (totalConcepts === 0) {
          return { content: [{ type: "text" as const, text: `No related concepts found for rxcui '${params.rxcui}' with the given scope/filters.` }] };
        }

        const structured = { rxcui: params.rxcui, scope: params.scope, concept_groups: groups };
        return buildResult(params.response_format, structured, () => {
          const lines = [`# Related Concepts: rxcui ${params.rxcui} (${params.scope})`, ""];
          for (const group of groups) {
            if (!group.conceptProperties?.length) continue;
            lines.push(`## ${group.tty ?? "Unknown TTY"} (${group.conceptProperties.length})`, "");
            for (const c of group.conceptProperties) {
              lines.push(`- **${c.name}** (rxcui: ${c.rxcui})`);
            }
            lines.push("");
          }
          return lines.join("\n");
        });
      } catch (error) {
        return errorResult(describeRxNavError(error, "getting related concepts"));
      }
    }
  );

  // ---------------------------------------------------------------------
  // rxnav_get_ndcs
  // ---------------------------------------------------------------------
  const GetNdcsInputSchema = z.object({ rxcui: rxcuiField, response_format: responseFormatField }).strict();
  type GetNdcsInput = z.infer<typeof GetNdcsInputSchema>;

  server.registerTool(
    "rxnav_get_ndcs",
    {
      title: "Get NDCs for an RxCUI",
      description: `Get the National Drug Codes (NDCs) currently associated with an RxNorm concept (11-digit CMS-derivative form).

Args:
  - rxcui (string): RxNorm concept identifier for a drug PRODUCT (typically an SCD/SBD/GPCK/BPCK — ingredient-only RxCUIs will return no NDCs).
  - response_format ('markdown' | 'json'): Output format (default 'markdown').

Returns: List of NDC strings.

Examples:
  - Use when: "What NDCs correspond to this drug product?" -> { rxcui: "213269" }
  - Don't use when: you're starting from an NDC and want the RxCUI (use rxnav_find_rxcui with id_type='NDC' instead).

Error Handling:
  - An empty result for an ingredient-level RxCUI is expected — NDCs are assigned to marketed products, not ingredients. Use rxnav_search_drugs to find product-level RxCUIs first.`,
      inputSchema: GetNdcsInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: GetNdcsInput) => {
      try {
        const data = await rxnavGet<{ ndcGroup?: { rxcui?: string; ndcList?: { ndc?: string[] } } }>(
          `rxcui/${params.rxcui}/ndcs`
        );
        const ndcs = data.ndcGroup?.ndcList?.ndc ?? [];
        if (ndcs.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No NDCs found for rxcui '${params.rxcui}'. This is expected for ingredient-level concepts — NDCs are only assigned to marketed drug products.`,
              },
            ],
          };
        }
        const structured = { rxcui: params.rxcui, ndcs };
        return buildResult(params.response_format, structured, () =>
          [`# NDCs for rxcui ${params.rxcui}`, "", `${ndcs.length} NDC(s):`, "", ...ndcs.map((n) => `- ${n}`)].join("\n")
        );
      } catch (error) {
        return errorResult(describeRxNavError(error, "getting NDCs"));
      }
    }
  );

  // ---------------------------------------------------------------------
  // rxnav_get_ndc_properties
  // ---------------------------------------------------------------------
  const NdcPropsInputSchema = z
    .object({
      ndc: z.string().min(4).describe("NDC in 11-digit, 5-3-2, 5-4-1, or 4-4-2 format, e.g. '00069420030' or '0069-4200-30'."),
      response_format: responseFormatField,
    })
    .strict();
  type NdcPropsInput = z.infer<typeof NdcPropsInputSchema>;

  server.registerTool(
    "rxnav_get_ndc_properties",
    {
      title: "Get Properties of an NDC",
      description: `Get detailed product/packaging properties for a specific National Drug Code (NDC), including the mapped RxCUI, splSetId, packaging description, and RxNorm property fields.

Args:
  - ndc (string): NDC in any standard segmentation, e.g. '00069420030'.
  - response_format ('markdown' | 'json'): Output format (default 'markdown').

Returns: NDC item detail — rxcui, ndc9/10/11, packaging list, and property list.

Examples:
  - Use when: "What drug does this NDC on the package label correspond to?" -> { ndc: "00069420030" }

Error Handling:
  - Returns "No properties found" if the NDC is unrecognized — verify formatting or try rxnav_get_ndc_status for a lighter-weight lookup.`,
      inputSchema: NdcPropsInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: NdcPropsInput) => {
      try {
        const data = await rxnavGet<{ ndcPropertyList?: { ndcProperty?: Array<Record<string, unknown>> } }>(
          "ndcproperties",
          { id: params.ndc }
        );
        const items = data.ndcPropertyList?.ndcProperty ?? [];
        if (items.length === 0) {
          return { content: [{ type: "text" as const, text: `No properties found for NDC '${params.ndc}'.` }] };
        }
        return buildResult(params.response_format, { ndc: params.ndc, properties: items }, () =>
          items
            .map(
              (item, i) =>
                `## Result ${i + 1}\n\n` +
                Object.entries(item)
                  .map(([k, v]) => bullet(k, typeof v === "object" ? JSON.stringify(v) : v))
                  .join("")
            )
            .join("\n")
        );
      } catch (error) {
        return errorResult(describeRxNavError(error, "getting NDC properties"));
      }
    }
  );

  // ---------------------------------------------------------------------
  // rxnav_get_ndc_status
  // ---------------------------------------------------------------------
  const NdcStatusInputSchema = z
    .object({
      ndc: z.string().min(4).describe("NDC in 11-digit, 5-3-2, 5-4-1, or 4-4-2 format."),
      include_history: z.boolean().default(false).describe("If true, include the full status change history rather than just the latest status (default false)."),
      response_format: responseFormatField,
    })
    .strict();
  type NdcStatusInput = z.infer<typeof NdcStatusInputSchema>;

  server.registerTool(
    "rxnav_get_ndc_status",
    {
      title: "Get NDC Marketing Status",
      description: `Look up whether a National Drug Code is currently active, obsolete, or alien (never in RxNorm), along with the RxNorm concept it maps to and (optionally) its full status history.

Args:
  - ndc (string): NDC to check.
  - include_history (boolean): Include full status change history (default false — latest status only).
  - response_format ('markdown' | 'json'): Output format (default 'markdown').

Returns: Status ('ACTIVE'/'OBSOLETE'/'ALIEN'), mapped RxCUI and concept name, and (if requested) history entries.

Examples:
  - Use when: "Is this NDC still active, and what does it map to?" -> { ndc: "00069420030" }`,
      inputSchema: NdcStatusInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: NdcStatusInput) => {
      try {
        const data = await rxnavGet<{ ndcStatus?: Record<string, unknown> }>("ndcstatus", {
          ndc: params.ndc,
          history: params.include_history ? 1 : 0,
        });
        const status = data.ndcStatus;
        if (!status) {
          return { content: [{ type: "text" as const, text: `No status found for NDC '${params.ndc}'.` }] };
        }
        return buildResult(params.response_format, { ndc_status: status }, () =>
          [`# NDC Status: ${params.ndc}`, "", ...Object.entries(status).map(([k, v]) => bullet(k, typeof v === "object" ? JSON.stringify(v) : v))].join("")
        );
      } catch (error) {
        return errorResult(describeRxNavError(error, "getting NDC status"));
      }
    }
  );

  // ---------------------------------------------------------------------
  // rxnav_find_related_ndcs
  // ---------------------------------------------------------------------
  const RelatedNdcsInputSchema = z
    .object({
      ndc: z.string().min(4).describe("Starting NDC (any standard segmentation)."),
      relation: z
        .enum(["concept", "product", "drug"])
        .describe("'concept': other NDCs of the exact same RxNorm concept. 'product': other NDCs of the same NDC product. 'drug': other NDCs of the same active drug ingredient/strength (broadest)."),
      ndc_status: z
        .array(z.enum(["active", "obsolete", "alien", "ALL"]))
        .default(["active"])
        .describe("Which NDC statuses to include (default ['active'])."),
      response_format: responseFormatField,
    })
    .strict();
  type RelatedNdcsInput = z.infer<typeof RelatedNdcsInputSchema>;

  server.registerTool(
    "rxnav_find_related_ndcs",
    {
      title: "Find NDCs Related to a Given NDC",
      description: `Given one NDC, find other NDCs related to it at a chosen level of granularity — same exact RxNorm concept, same NDC product, or same active drug (e.g. all manufacturers/packagings of the same drug and strength). Useful for reconciling different package sizes or repackagers of what is clinically the same product.

Args:
  - ndc (string): Starting NDC.
  - relation ('concept' | 'product' | 'drug'): Scope of relatedness — 'drug' is broadest.
  - ndc_status (array, optional): NDC statuses to include (default ['active']).
  - response_format ('markdown' | 'json'): Output format (default 'markdown').

Returns: List of related NDCs with their status, mapped RxCUI, concept name, and term type.

Examples:
  - Use when: "What other package sizes exist for this exact product?" -> { ndc: "...", relation: "product" }
  - Use when: "What other NDCs exist for this same drug, from any manufacturer?" -> { ndc: "...", relation: "drug" }`,
      inputSchema: RelatedNdcsInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: RelatedNdcsInput) => {
      try {
        const data = await rxnavGet<{ ndcInfoList?: { ndcInfo?: Array<Record<string, unknown>> } }>("relatedndc", {
          ndc: params.ndc,
          relation: params.relation,
          ndcstatus: params.ndc_status.join(" "),
        });
        const items = data.ndcInfoList?.ndcInfo ?? [];
        if (items.length === 0) {
          return { content: [{ type: "text" as const, text: `No related NDCs found for '${params.ndc}' with relation='${params.relation}'.` }] };
        }
        return buildResult(params.response_format, { ndc: params.ndc, relation: params.relation, related: items }, () =>
          renderTable(items, `NDCs Related to ${params.ndc} (${params.relation})`)
        );
      } catch (error) {
        return errorResult(describeRxNavError(error, "finding related NDCs"));
      }
    }
  );

  // ---------------------------------------------------------------------
  // rxnav_get_historical_ndcs
  // ---------------------------------------------------------------------
  const HistoricalNdcsInputSchema = z.object({ rxcui: rxcuiField, response_format: responseFormatField }).strict();
  type HistoricalNdcsInput = z.infer<typeof HistoricalNdcsInputSchema>;

  server.registerTool(
    "rxnav_get_historical_ndcs",
    {
      title: "Get All Historical NDCs for an RxCUI",
      description: `Get every NDC ever associated with an RxNorm concept over time, grouped by the RxNorm version/date in which each mapping was recorded — including NDCs that are no longer active. Use this instead of rxnav_get_ndcs when reconciling old claims/label data where the NDC may have been retired.

Args:
  - rxcui (string): RxNorm concept identifier.
  - response_format ('markdown' | 'json'): Output format (default 'markdown').

Returns: NDCs grouped by the historical time period in which they were valid.`,
      inputSchema: HistoricalNdcsInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: HistoricalNdcsInput) => {
      try {
        const data = await rxnavGet<{ historicalNdcConcept?: { historicalNdcTime?: Array<Record<string, unknown>> } }>(
          `rxcui/${params.rxcui}/allhistoricalndcs`
        );
        const periods = data.historicalNdcConcept?.historicalNdcTime ?? [];
        if (periods.length === 0) {
          return { content: [{ type: "text" as const, text: `No historical NDCs found for rxcui '${params.rxcui}'.` }] };
        }
        return buildResult(params.response_format, { rxcui: params.rxcui, periods }, () =>
          [`# Historical NDCs: rxcui ${params.rxcui}`, "", "```json", JSON.stringify(periods, null, 2), "```"].join("\n")
        );
      } catch (error) {
        return errorResult(describeRxNavError(error, "getting historical NDCs"));
      }
    }
  );

  // ---------------------------------------------------------------------
  // rxnav_get_rxcui_history_status
  // ---------------------------------------------------------------------
  const HistoryStatusInputSchema = z.object({ rxcui: rxcuiField, response_format: responseFormatField }).strict();
  type HistoryStatusInput = z.infer<typeof HistoryStatusInputSchema>;

  server.registerTool(
    "rxnav_get_rxcui_history_status",
    {
      title: "Get RxCUI Lifecycle Status",
      description: `Check whether an RxCUI is currently Active, Obsolete, Remapped, Quantified, or Never-Active, and — if it changed — what it was remapped to. Use this whenever a lookup by RxCUI unexpectedly returns nothing, to find out if the concept was retired or merged into another.

Args:
  - rxcui (string): RxNorm concept identifier to check.
  - response_format ('markdown' | 'json'): Output format (default 'markdown').

Returns: Lifecycle status, and (for remapped concepts) the current replacement RxCUI(s).

Examples:
  - Use when: "Why does this old RxCUI from a 2019 dataset return nothing now?" -> { rxcui: "..." }`,
      inputSchema: HistoryStatusInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: HistoryStatusInput) => {
      try {
        const data = await rxnavGet<{ rxcuiStatusHistory?: Record<string, unknown> }>(
          `rxcui/${params.rxcui}/historystatus`
        );
        const status = data.rxcuiStatusHistory;
        if (!status) {
          return { content: [{ type: "text" as const, text: `No history found for rxcui '${params.rxcui}'.` }] };
        }
        return buildResult(params.response_format, { history: status }, () =>
          [`# RxCUI History: ${params.rxcui}`, "", "```json", JSON.stringify(status, null, 2), "```"].join("\n")
        );
      } catch (error) {
        return errorResult(describeRxNavError(error, "getting RxCUI history status"));
      }
    }
  );

  // ---------------------------------------------------------------------
  // rxnav_filter_by_property
  // ---------------------------------------------------------------------
  const FilterInputSchema = z
    .object({
      rxcui: rxcuiField,
      prop_name: z.string().min(1).describe("Property name to test, e.g. 'TTY' or 'STATUS'. See rxnav_get_reference_data(type='prop_names') for valid values."),
      prop_values: z.array(z.string()).optional().describe("Acceptable values for prop_name, e.g. ['IN','PIN'] to test whether the concept is an ingredient-type. Omit to just check the property exists."),
      response_format: responseFormatField,
    })
    .strict();
  type FilterInput = z.infer<typeof FilterInputSchema>;

  server.registerTool(
    "rxnav_filter_by_property",
    {
      title: "Test Whether a Concept Matches a Property Filter",
      description: `Check whether a given RxCUI's property (e.g. term type, status) matches one of a set of acceptable values — a quick boolean-style filter, useful when scripting bulk checks across many RxCUIs (e.g. "is this concept an ingredient?").

Args:
  - rxcui (string): Concept to test.
  - prop_name (string): Property to test, e.g. 'TTY'.
  - prop_values (string[], optional): Acceptable values, e.g. ['IN','PIN'].
  - response_format ('markdown' | 'json'): Output format (default 'markdown').

Returns: The rxcui if it matches, or a clear "does not match" result if not.

Examples:
  - Use when: "Is rxcui 7052 an ingredient or precise ingredient?" -> { rxcui: "7052", prop_name: "TTY", prop_values: ["IN","PIN"] }`,
      inputSchema: FilterInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: FilterInput) => {
      try {
        const data = await rxnavGet<{ rxcui?: string }>(`rxcui/${params.rxcui}/filter`, {
          propName: params.prop_name,
          propValues: params.prop_values?.join(" "),
        });
        const matched = Boolean(data.rxcui);
        const structured = { rxcui: params.rxcui, prop_name: params.prop_name, prop_values: params.prop_values, matched };
        return buildResult(params.response_format, structured, () =>
          matched
            ? `rxcui ${params.rxcui} matches ${params.prop_name}${params.prop_values ? ` in [${params.prop_values.join(", ")}]` : ""}.`
            : `rxcui ${params.rxcui} does NOT match ${params.prop_name}${params.prop_values ? ` in [${params.prop_values.join(", ")}]` : ""}.`
        );
      } catch (error) {
        return errorResult(describeRxNavError(error, "filtering by property"));
      }
    }
  );

  // ---------------------------------------------------------------------
  // rxnav_get_reference_data
  // ---------------------------------------------------------------------
  const ReferenceDataInputSchema = z
    .object({
      type: z
        .enum(["id_types", "term_types", "prop_names", "prop_categories", "rela_types", "source_types"])
        .describe(
          "Which reference list to fetch: 'id_types' (valid id_type values for rxnav_find_rxcui), 'term_types' (valid TTY values), 'prop_names' (valid property names), 'prop_categories' (categories properties fall under), 'rela_types' (valid RxNorm relationship names), or 'source_types' (source vocabularies RxNorm draws from)."
        ),
      response_format: responseFormatField,
    })
    .strict();
  type ReferenceDataInput = z.infer<typeof ReferenceDataInputSchema>;

  const REFERENCE_ENDPOINTS: Record<ReferenceDataInput["type"], string> = {
    id_types: "idtypes",
    term_types: "termtypes",
    prop_names: "propnames",
    prop_categories: "propCategories",
    rela_types: "relatypes",
    source_types: "sourcetypes",
  };

  server.registerTool(
    "rxnav_get_reference_data",
    {
      title: "Get RxNorm Reference/Metadata Lists",
      description: `Get one of RxNorm's fixed reference lists — the valid values accepted by other tools' enum-like parameters (id types, term types, property names, relationship types, source vocabularies). Call this when unsure what value to pass to another tool's id_type, term_types, relationships, or prop_name parameter.

Args:
  - type ('id_types' | 'term_types' | 'prop_names' | 'prop_categories' | 'rela_types' | 'source_types'): Which list to fetch.
  - response_format ('markdown' | 'json'): Output format (default 'markdown').

Returns: The full list of valid values for the requested reference type.

Examples:
  - Use when: "What relationship names can I filter on in rxnav_get_related_concepts?" -> { type: "rela_types" }
  - Use when: "What TTY codes exist?" -> { type: "term_types" }`,
      inputSchema: ReferenceDataInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: ReferenceDataInput) => {
      try {
        const data = await rxnavGet<Record<string, unknown>>(REFERENCE_ENDPOINTS[params.type]);
        const values = asStringList(extractFirstArray(data));
        if (values.length === 0) {
          return { content: [{ type: "text" as const, text: `No values returned for reference type '${params.type}'.` }] };
        }
        return buildResult(params.response_format, { type: params.type, values }, () =>
          [`# Reference Data: ${params.type}`, "", `${values.length} value(s):`, "", ...values.map((v) => `- ${v}`)].join("\n")
        );
      } catch (error) {
        return errorResult(describeRxNavError(error, `getting reference data (${params.type})`));
      }
    }
  );

  // ---------------------------------------------------------------------
  // rxnav_get_version
  // ---------------------------------------------------------------------
  server.registerTool(
    "rxnav_get_version",
    {
      title: "Get RxNorm Dataset Version",
      description: `Get the current RxNorm data set version and the API version serving it. Useful for confirming freshness/provenance before relying on results in a report.

Args: (none)
  - response_format ('markdown' | 'json'): Output format (default 'markdown').

Returns: RxNorm version string and API version string.`,
      inputSchema: z.object({ response_format: responseFormatField }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: { response_format: ResponseFormat }) => {
      try {
        const data = await rxnavGet<{ version?: Record<string, unknown> }>("version");
        return buildResult(params.response_format, { version: data.version ?? data }, () =>
          [`# RxNorm Version`, "", "```json", JSON.stringify(data.version ?? data, null, 2), "```"].join("\n")
        );
      } catch (error) {
        return errorResult(describeRxNavError(error, "getting the RxNorm version"));
      }
    }
  );
}
