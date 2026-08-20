/**
 * Tools wrapping the RxClass REST API (drug classes and their members across
 * multiple classification systems — ATC, MeSH, EPC, MOA/PE/PK, DailyMed, etc).
 * See: https://lhncbc.nlm.nih.gov/RxNav/APIs/RxClassAPIs.html
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { rxnavGet, describeRxNavError } from "../services/rxnav-client.js";
import { buildResult, errorResult, renderTable } from "../services/format.js";
import { extractFirstArray } from "../services/generic.js";
import { responseFormatField } from "../schemas/common.js";
import type { RxClassDrugInfo, RxClassItem } from "../types.js";

const CLASS_TYPES = [
  "ATC1-4",
  "MESHPA",
  "EPC",
  "MOA",
  "PE",
  "PK",
  "TC",
  "VA",
  "DISEASE",
  "DISPOSITION",
  "CHEM",
  "SCHEDULE",
  "STRUCT",
] as const;

export function registerRxClassTools(server: McpServer): void {
  // ---------------------------------------------------------------------
  // rxnav_find_drug_classes_by_name
  // ---------------------------------------------------------------------
  const FindClassByNameSchema = z
    .object({
      class_name: z.string().min(1).describe("Drug class name to search for, e.g. 'ACE Inhibitors' or 'Penicillins'."),
      response_format: responseFormatField,
    })
    .strict();
  type FindClassByNameInput = z.infer<typeof FindClassByNameSchema>;

  server.registerTool(
    "rxnav_find_drug_classes_by_name",
    {
      title: "Find Drug Classes by Name",
      description: `Search across all RxClass classification systems (ATC, MeSH Pharmacologic Action, DailyMed EPC, mechanism/physiologic effect, VA drug classes, disease, chemical structure, and more) for classes matching a name.

Args:
  - class_name (string): Class name or partial name to search, e.g. 'ACE Inhibitors'.
  - response_format ('markdown' | 'json'): Output format (default 'markdown').

Returns: Matching classes with their class ID and classification system (classType).

Examples:
  - Use when: "Find the drug class ID for beta blockers" -> { class_name: "Beta-Adrenergic Blocking Agents" }
  - Don't use when: you already have an rxcui and want ITS classes (use rxnav_get_drug_classes instead).`,
      inputSchema: FindClassByNameSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: FindClassByNameInput) => {
      try {
        const data = await rxnavGet<{ rxclassMinConceptList?: { rxclassMinConceptItem?: RxClassItem[] } }>(
          "rxclass/class/byName",
          { className: params.class_name }
        );
        const classes = data.rxclassMinConceptList?.rxclassMinConceptItem ?? [];
        if (classes.length === 0) {
          return { content: [{ type: "text" as const, text: `No drug classes found matching '${params.class_name}'.` }] };
        }
        return buildResult(params.response_format, { class_name: params.class_name, classes }, () =>
          renderTable(classes, `Drug Classes Matching '${params.class_name}'`)
        );
      } catch (error) {
        return errorResult(describeRxNavError(error, "finding drug classes by name"));
      }
    }
  );

  // ---------------------------------------------------------------------
  // rxnav_get_drug_classes
  // ---------------------------------------------------------------------
  const GetDrugClassesSchema = z
    .object({
      rxcui: z.string().regex(/^\d+$/).optional().describe("RxCUI of the drug. Provide this OR drug_name, not both."),
      drug_name: z.string().min(1).optional().describe("Drug name (ingredient or brand). Provide this OR rxcui, not both."),
      relationship_source: z
        .enum(["ATC", "ATCPROD", "DAILYMED", "FDASPL", "FMTSME", "MEDRT", "RXNORM", "SNOMEDCT", "VA", "ALL"])
        .default("ALL")
        .describe("Restrict to one source of drug-class relationships, e.g. 'FDASPL' for FDA labeling-derived classes (EPC/MOA/PE), 'MEDRT' for may_treat/may_prevent/contraindication relationships, 'ATC' for ATC1-4 (default 'ALL')."),
      relationship_names: z
        .array(z.string())
        .optional()
        .describe("Restrict to specific relationship names, e.g. ['may_treat'] or ['has_EPC']. Only takes effect when relationship_source is not 'ALL'. See rxnav_get_class_reference_data(type='relationship_names')."),
      class_types: z
        .array(z.enum(CLASS_TYPES))
        .optional()
        .describe(
          "Client-side filter applied AFTER fetching: keep only results whose classification system is one of these, e.g. ['EPC']. (RxClass has no server-side class-type filter for this lookup, so this fetches everything and filters locally.)"
        ),
      response_format: responseFormatField,
    })
    .strict();
  // Cross-field validation (rxcui XOR drug_name) is enforced in the handler —
  // see the note on rxnav_find_rxcui above for why .refine() is avoided here.
  type GetDrugClassesInput = z.infer<typeof GetDrugClassesSchema>;

  server.registerTool(
    "rxnav_get_drug_classes",
    {
      title: "Get Drug Classes for a Drug",
      description: `Get every drug class a drug belongs to — therapeutic (ATC, VA), FDA Established Pharmacologic Class (EPC), mechanism of action (MOA), physiologic effect (PE), disease it may treat/prevent/is contraindicated with (MEDRT), and more.

Args:
  - rxcui (string, optional): Drug's RxCUI. Provide this OR drug_name.
  - drug_name (string, optional): Drug name. Provide this OR rxcui.
  - relationship_source (string): Restrict to one relationship source (default 'ALL'). Use 'FDASPL' for EPC/MOA/PE, 'MEDRT' for may_treat/may_prevent/ci_with, 'ATC' for therapeutic classes.
  - relationship_names (string[], optional): Restrict to specific relationship names (e.g. ['may_treat']) — only effective together with a non-'ALL' relationship_source.
  - class_types (string[], optional): Keep only these classification systems, e.g. ['EPC']. Applied client-side after fetching (RxClass doesn't support this filter server-side here).
  - response_format ('markdown' | 'json'): Output format (default 'markdown').

Returns: Each matching class with its class ID, class name, classification system, the relationship type (rela, e.g. 'may_treat', 'has_EPC'), and its source.

Examples:
  - Use when: "What FDA pharmacologic classes does lisinopril belong to?" -> { drug_name: "lisinopril", relationship_source: "FDASPL", class_types: ["EPC"] }
  - Use when: "What conditions might this drug treat, per MEDRT?" -> { rxcui: "29046", relationship_source: "MEDRT", relationship_names: ["may_treat"] }
  - Don't use when: you want the reverse — drugs IN a known class (use rxnav_get_class_members).`,
      inputSchema: GetDrugClassesSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: GetDrugClassesInput) => {
      try {
        if (Boolean(params.rxcui) === Boolean(params.drug_name)) {
          return errorResult("Error: Provide exactly one of `rxcui` or `drug_name`.");
        }
        const path = params.rxcui ? "rxclass/class/byRxcui" : "rxclass/class/byDrugName";
        const data = await rxnavGet<{ rxclassDrugInfoList?: { rxclassDrugInfo?: RxClassDrugInfo[] } }>(path, {
          rxcui: params.rxcui,
          drugName: params.drug_name,
          relaSource: params.relationship_source,
          relas: params.relationship_source !== "ALL" ? params.relationship_names?.join(" ") : undefined,
        });
        let items = data.rxclassDrugInfoList?.rxclassDrugInfo ?? [];
        if (params.class_types?.length) {
          const allowed = new Set<string>(params.class_types);
          items = items.filter((i) => i.rxclassMinConceptItem?.classType && allowed.has(i.rxclassMinConceptItem.classType));
        }
        if (items.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No drug classes found for ${params.rxcui ? `rxcui '${params.rxcui}'` : `'${params.drug_name}'`} with the given filters.`,
              },
            ],
          };
        }
        const structured = { query: params.rxcui ?? params.drug_name, classes: items };
        return buildResult(params.response_format, structured, () =>
          renderTable(
            items.map((i) => ({
              class_id: i.rxclassMinConceptItem?.classId,
              class_name: i.rxclassMinConceptItem?.className,
              class_type: i.rxclassMinConceptItem?.classType,
              rela: i.rela,
              rela_source: i.relaSource,
              matched_concept: i.minConcept?.name,
            })),
            `Drug Classes for ${params.rxcui ?? params.drug_name}`
          )
        );
      } catch (error) {
        return errorResult(describeRxNavError(error, "getting drug classes"));
      }
    }
  );

  // ---------------------------------------------------------------------
  // rxnav_get_class_members
  // ---------------------------------------------------------------------
  const GetClassMembersSchema = z
    .object({
      class_id: z.string().min(1).describe("Class identifier, e.g. 'N0000175503' (get one via rxnav_find_drug_classes_by_name)."),
      relationship_source: z
        .enum(["ATC", "ATCPROD", "DAILYMED", "FDASPL", "FMTSME", "MEDRT", "RXNORM", "SNOMEDCT", "VA"])
        .default("ATC")
        .describe("Source of the drug-class relationship to use — must match the classification system class_id belongs to, e.g. 'ATC' for ATC1-4 classes, 'FDASPL' for EPC classes (default 'ATC')."),
      rela: z.string().optional().describe("Restrict to a specific relationship name, e.g. 'has_EPC' or 'may_treat'. Optional."),
      response_format: responseFormatField,
    })
    .strict();
  type GetClassMembersInput = z.infer<typeof GetClassMembersSchema>;

  server.registerTool(
    "rxnav_get_class_members",
    {
      title: "Get Drugs Belonging to a Class",
      description: `Get the RxNorm drug members of a given drug class — the reverse of rxnav_get_drug_classes. E.g. list every ingredient classified as an ACE Inhibitor.

Args:
  - class_id (string): Class identifier, e.g. 'N0000175503'. Get one from rxnav_find_drug_classes_by_name.
  - relationship_source (string): Source matching the class's system (default 'ATC'). MUST correspond to class_id's classType — e.g. use 'FDASPL' for an EPC class_id, 'ATC' for an ATC1-4 class_id.
  - rela (string, optional): Restrict to one relationship name.
  - response_format ('markdown' | 'json'): Output format (default 'markdown').

Returns: Member drugs with rxcui, name, and term type.

Examples:
  - Use when: "List all ACE inhibitors" -> first rxnav_find_drug_classes_by_name({class_name:'ACE Inhibitors'}) to get class_id, then this tool with relationship_source='ATC'.

Error Handling:
  - Empty results usually mean relationship_source doesn't match the class's system — check the classType returned by rxnav_find_drug_classes_by_name.`,
      inputSchema: GetClassMembersSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: GetClassMembersInput) => {
      try {
        const data = await rxnavGet<{ drugMemberGroup?: { drugMember?: Array<{ minConcept?: { rxcui: string; name: string; tty: string } }> } }>(
          "rxclass/classMembers",
          { classId: params.class_id, relaSource: params.relationship_source, rela: params.rela }
        );
        const members = data.drugMemberGroup?.drugMember ?? [];
        if (members.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No members found for class '${params.class_id}' via relationship_source='${params.relationship_source}'. Double-check relationship_source matches this class's classType.`,
              },
            ],
          };
        }
        const structured = { class_id: params.class_id, members: members.map((m) => m.minConcept) };
        return buildResult(params.response_format, structured, () =>
          renderTable(
            members.map((m) => ({ rxcui: m.minConcept?.rxcui, name: m.minConcept?.name, tty: m.minConcept?.tty })),
            `Members of Class ${params.class_id}`
          )
        );
      } catch (error) {
        return errorResult(describeRxNavError(error, "getting class members"));
      }
    }
  );

  // ---------------------------------------------------------------------
  // rxnav_get_class_hierarchy
  // ---------------------------------------------------------------------
  const ClassHierarchySchema = z
    .object({
      class_id: z.string().min(1).describe("Class identifier to navigate from."),
      direction: z
        .enum(["ancestors", "descendants"])
        .default("descendants")
        .describe("'descendants' returns subclasses below this class; 'ancestors' returns the path up to the root of the hierarchy (default 'descendants')."),
      source: z.enum(["MESHPA", "ATC1-4", "VA"]).default("MESHPA").describe("Which hierarchical classification tree to navigate (default 'MESHPA'). Only MESHPA, ATC1-4, and VA classes have a tree hierarchy."),
      response_format: responseFormatField,
    })
    .strict();
  type ClassHierarchyInput = z.infer<typeof ClassHierarchySchema>;

  server.registerTool(
    "rxnav_get_class_hierarchy",
    {
      title: "Navigate a Drug Class Hierarchy",
      description: `Walk up or down a hierarchical drug classification tree (MeSH Pharmacologic Action, ATC1-4, or VA drug classes are the only ones with tree structure). 'descendants' finds narrower subclasses; 'ancestors' finds the path to the root.

Args:
  - class_id (string): Starting class identifier.
  - direction ('ancestors' | 'descendants'): Which way to navigate (default 'descendants').
  - source ('MESHPA' | 'ATC1-4' | 'VA'): Which tree (default 'MESHPA').
  - response_format ('markdown' | 'json'): Output format (default 'markdown').

Returns: The list of classes along the requested path, each with class ID and name.

Examples:
  - Use when: "What are the ATC subclasses under this therapeutic class?" -> { class_id: "C09", direction: "descendants", source: "ATC1-4" }`,
      inputSchema: ClassHierarchySchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: ClassHierarchyInput) => {
      try {
        if (params.direction === "ancestors") {
          // rxclass/classContext takes only classId (no classType) and returns
          // every path from this class up to the root(s) of its hierarchy.
          const data = await rxnavGet<{ classPathList?: { classPath?: Array<{ rxclassMinConcept?: RxClassItem[] }> } }>(
            "rxclass/classContext",
            { classId: params.class_id }
          );
          const paths = data.classPathList?.classPath ?? [];
          if (paths.length === 0) {
            return { content: [{ type: "text" as const, text: `No ancestor path found for class '${params.class_id}'.` }] };
          }
          return buildResult(params.response_format, { class_id: params.class_id, paths }, () => {
            const lines = [`# Ancestor Path(s) for ${params.class_id}`, "", `${paths.length} path(s) to the root:`, ""];
            paths.forEach((p, i) => {
              const chain = (p.rxclassMinConcept ?? []).map((c) => `${c.className} (${c.classId})`).join(" → ");
              lines.push(`${i + 1}. ${params.class_id} → ${chain}`);
            });
            return lines.join("\n");
          });
        }

        // rxclass/classTree returns a (possibly recursive) tree of descendants,
        // scoped by classType (only MESHPA / ATC1-4 / VA have real hierarchies).
        interface ClassTreeNode {
          rxclassMinConceptItem?: RxClassItem;
          rxclassTree?: ClassTreeNode[];
        }
        const data = await rxnavGet<{ rxclassTree?: ClassTreeNode[] }>("rxclass/classTree", {
          classId: params.class_id,
          classType: params.source,
        });
        const roots = data.rxclassTree ?? [];
        if (roots.length === 0) {
          return { content: [{ type: "text" as const, text: `No descendants found for class '${params.class_id}' in ${params.source}.` }] };
        }

        const flat: Array<{ class_id?: string; class_name?: string; class_type?: string; child_count: number }> = [];
        const flatten = (nodes: ClassTreeNode[]) => {
          for (const node of nodes) {
            flat.push({
              class_id: node.rxclassMinConceptItem?.classId,
              class_name: node.rxclassMinConceptItem?.className,
              class_type: node.rxclassMinConceptItem?.classType,
              child_count: node.rxclassTree?.length ?? 0,
            });
            if (node.rxclassTree?.length) flatten(node.rxclassTree);
          }
        };
        flatten(roots);

        return buildResult(params.response_format, { class_id: params.class_id, source: params.source, tree: roots, flattened: flat }, () =>
          renderTable(flat, `Descendants of ${params.class_id} (${params.source})`)
        );
      } catch (error) {
        return errorResult(describeRxNavError(error, "navigating the class hierarchy"));
      }
    }
  );

  // ---------------------------------------------------------------------
  // rxnav_get_similar_classes
  // ---------------------------------------------------------------------
  const SimilarClassesSchema = z
    .object({
      class_id: z.string().optional().describe("A class identifier to find similar classes for. Provide this OR rxcuis, not both. Requires relationship_source and relationship_name."),
      rxcuis: z
        .array(z.string().regex(/^\d+$/))
        .max(500)
        .optional()
        .describe("A list of RxCUIs (max 500) — find classes with clinically-significant ingredient overlap with this drug list. Provide this OR class_id."),
      relationship_source: z
        .enum(["ATC", "ATCPROD", "DAILYMED", "FDASPL", "FMTSME", "MEDRT", "RXNORM", "SNOMEDCT", "VA", "ALL"])
        .default("ATC")
        .describe("Source of drug-class relationships to compare against. REQUIRED (no 'ALL') when using class_id; defaults to 'ATC'. Optional (defaults to 'ALL') when using rxcuis."),
      relationship_name: z
        .string()
        .optional()
        .describe("Relationship name, e.g. 'has_ingredient'. REQUIRED when using class_id (RxClass has no 'ALL' option for this path — see rxnav_get_class_reference_data(type='relationship_names')). Optional (defaults to all) when using rxcuis."),
      top: z.number().int().min(1).max(100).default(10).describe("Maximum number of ranked results to return (1-100, default 10)."),
      response_format: responseFormatField,
    })
    .strict();
  // Cross-field validation (class_id XOR rxcuis, and class_id's stricter
  // required-param rules) is enforced in the handler — see the note on
  // rxnav_find_rxcui above for why .refine() is avoided here.
  type SimilarClassesInput = z.infer<typeof SimilarClassesSchema>;

  interface RankClassConcept {
    similarityEntityItem?: {
      equivalenceScore?: string;
      inclusionScore?: string;
      intersection?: string;
      cardinality1?: string;
      cardinality2?: string;
    };
    drugClassConceptItem?: {
      rela?: string | null;
      relaSource?: string;
      rxclassMinConceptItem?: RxClassItem;
    };
  }

  server.registerTool(
    "rxnav_get_similar_classes",
    {
      title: "Find Classes with Similar Drug Membership",
      description: `Find drug classes whose clinically-significant ingredient membership overlaps with a given class, or with a given list of drugs (RxCUIs), ranked by an equivalence/inclusion score — useful for finding a therapeutic-equivalent class, or characterizing an ad hoc drug list by the classes it most resembles.

Args:
  - class_id (string, optional): Reference class. Provide this OR rxcuis. When used, relationship_source and relationship_name are BOTH required (RxClass has no 'ALL' shortcut on this path).
  - rxcuis (string[], optional, max 500): Reference drug list. Provide this OR class_id. relationship_source/relationship_name are optional here (default to comparing across everything).
  - relationship_source (string): Source of drug-class relationships (default 'ATC').
  - relationship_name (string, optional): Relationship name, e.g. 'has_ingredient'.
  - top (number): Max ranked results, 1-100 (default 10).
  - response_format ('markdown' | 'json'): Output format (default 'markdown').

Returns: Classes ranked by similarity score, with each class's ID/name/type and the equivalence/inclusion scores and intersection/cardinality counts behind the ranking.

Examples:
  - Use when: "What existing ATC classes best describe this ad hoc list of 8 drug RxCUIs?" -> { rxcuis: ["...", "..."] }
  - Use when: "What ATC1-4 class is most clinically similar to this one, by shared ingredients?" -> { class_id: "N02AA", relationship_source: "ATC", relationship_name: "has_ingredient" }

Error Handling:
  - Returns an actionable error if class_id is given without both relationship_source and relationship_name — RxClass requires both on this path.`,
      inputSchema: SimilarClassesSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: SimilarClassesInput) => {
      try {
        if (Boolean(params.class_id) === Boolean(params.rxcuis?.length)) {
          return errorResult("Error: Provide exactly one of `class_id` or `rxcuis`.");
        }
        if (params.class_id && (params.relationship_source === "ALL" || !params.relationship_name)) {
          return errorResult(
            "Error: When using `class_id`, both `relationship_source` (not 'ALL') and `relationship_name` are required by RxClass. Use rxnav_get_class_reference_data(type='relationship_names') to pick one."
          );
        }

        const path = params.class_id ? "rxclass/class/similar" : "rxclass/class/similarByRxcuis";
        const data = await rxnavGet<{
          rxclassdata?: { similarityMember?: { rankClassConcept?: RankClassConcept[] } };
          similarityMember?: { rankClassConcept?: RankClassConcept[] };
        }>(path, {
          classId: params.class_id,
          rxcuis: params.rxcuis?.join(" "),
          relaSource: params.relationship_source,
          rela: params.relationship_name,
          top: params.top,
        });
        const ranked = data.rxclassdata?.similarityMember?.rankClassConcept ?? data.similarityMember?.rankClassConcept ?? [];
        if (ranked.length === 0) {
          return { content: [{ type: "text" as const, text: "No similar classes found with the given filters." }] };
        }

        const rows = ranked.map((r) => ({
          class_id: r.drugClassConceptItem?.rxclassMinConceptItem?.classId,
          class_name: r.drugClassConceptItem?.rxclassMinConceptItem?.className,
          class_type: r.drugClassConceptItem?.rxclassMinConceptItem?.classType,
          equivalence_score: r.similarityEntityItem?.equivalenceScore,
          inclusion_score: r.similarityEntityItem?.inclusionScore,
          shared_ingredients: r.similarityEntityItem?.intersection,
        }));
        return buildResult(params.response_format, { query: params.class_id ?? params.rxcuis, ranked_classes: ranked }, () =>
          renderTable(rows, "Similar Classes (ranked by equivalence score)")
        );
      } catch (error) {
        return errorResult(describeRxNavError(error, "finding similar classes"));
      }
    }
  );

  // ---------------------------------------------------------------------
  // rxnav_get_class_reference_data
  // ---------------------------------------------------------------------
  const ClassReferenceDataSchema = z
    .object({
      type: z
        .enum(["class_types", "relationship_names", "relationship_sources"])
        .describe("'class_types' lists classification systems (ATC1-4, EPC, MOA, ...); 'relationship_names' lists rela values (may_treat, has_EPC, ...); 'relationship_sources' lists sources of drug-class relationships (ATC, FDASPL, MEDRT, ...)."),
      response_format: responseFormatField,
    })
    .strict();
  type ClassReferenceDataInput = z.infer<typeof ClassReferenceDataSchema>;

  const CLASS_REFERENCE_ENDPOINTS: Record<ClassReferenceDataInput["type"], string> = {
    class_types: "rxclass/classTypes",
    relationship_names: "rxclass/relas",
    relationship_sources: "rxclass/relaSources",
  };

  server.registerTool(
    "rxnav_get_class_reference_data",
    {
      title: "Get RxClass Reference/Metadata Lists",
      description: `Get one of RxClass's fixed reference lists — valid classification systems, relationship names, or relationship sources — for use as parameter values in the other rxnav_*class* tools.

Args:
  - type ('class_types' | 'relationship_names' | 'relationship_sources'): Which list to fetch.
  - response_format ('markdown' | 'json'): Output format (default 'markdown').

Returns: The full list of valid values for the requested reference type.

Examples:
  - Use when: "What relationship_source values can I pass to rxnav_get_class_members?" -> { type: "relationship_sources" }`,
      inputSchema: ClassReferenceDataSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: ClassReferenceDataInput) => {
      try {
        const data = await rxnavGet<Record<string, unknown>>(CLASS_REFERENCE_ENDPOINTS[params.type]);
        const items = extractFirstArray(data);
        if (items.length === 0) {
          return { content: [{ type: "text" as const, text: `No values returned for reference type '${params.type}'.` }] };
        }
        const rows = items.map((item) =>
          typeof item === "object" && item !== null ? (item as Record<string, unknown>) : { value: item }
        );
        return buildResult(params.response_format, { type: params.type, values: items }, () => renderTable(rows, `Reference Data: ${params.type}`));
      } catch (error) {
        return errorResult(describeRxNavError(error, `getting class reference data (${params.type})`));
      }
    }
  );
}
