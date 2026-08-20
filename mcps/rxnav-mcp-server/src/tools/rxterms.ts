/**
 * Tool wrapping the RxTerms REST API — a curated subset of RxNorm designed
 * for prescription-writing UIs (patient-friendly display names, dose forms,
 * strengths). See: https://lhncbc.nlm.nih.gov/RxNav/APIs/RxTermsAPIs.html
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { rxnavGet, describeRxNavError } from "../services/rxnav-client.js";
import { buildResult, errorResult, bullet } from "../services/format.js";
import { responseFormatField, rxcuiField } from "../schemas/common.js";
import type { RxTermsProperties } from "../types.js";

export function registerRxTermsTools(server: McpServer): void {
  const RxTermsInputSchema = z.object({ rxcui: rxcuiField, response_format: responseFormatField }).strict();
  type RxTermsInput = z.infer<typeof RxTermsInputSchema>;

  server.registerTool(
    "rxnav_get_rxterms_info",
    {
      title: "Get RxTerms Display Info for a Drug",
      description: `Get the RxTerms record for an RxNorm drug product — a patient/prescriber-friendly display name, dose form, strength, route, and brand/generic RxCUI cross-reference. RxTerms is NLM's curated subset of RxNorm purpose-built for prescription-writing and pick-list UIs, so its names are cleaner and more consistent than raw RxNorm SCD/SBD names.

Args:
  - rxcui (string): RxNorm concept identifier for a drug product.
  - response_format ('markdown' | 'json'): Output format (default 'markdown').

Returns: displayName, fullName, fullGenericName, strength, rxtermsDoseForm, route, brandName (if applicable), and genericRxcui (if this is a branded product).

Examples:
  - Use when: "Give me a clean, patient-facing name for this drug for a pick-list" -> { rxcui: "198440" }

Error Handling:
  - Returns "No RxTerms record found" if this RxCUI isn't part of the RxTerms subset (not every RxNorm concept is) — fall back to rxnav_get_concept_properties for the raw RxNorm name.`,
      inputSchema: RxTermsInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: RxTermsInput) => {
      try {
        const data = await rxnavGet<{ rxtermsProperties?: RxTermsProperties }>(`RxTerms/rxcui/${params.rxcui}/allinfo`);
        const props = data.rxtermsProperties;
        if (!props || Object.keys(props).length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No RxTerms record found for rxcui '${params.rxcui}'. Not every RxNorm concept is part of the curated RxTerms subset — try rxnav_get_concept_properties for the raw RxNorm name instead.`,
              },
            ],
          };
        }
        return buildResult(params.response_format, { rxterms: props }, () =>
          [
            `# RxTerms Info: rxcui ${params.rxcui}`,
            "",
            bullet("Display Name", props.displayName),
            bullet("Full Name", props.fullName),
            bullet("Full Generic Name", props.fullGenericName),
            bullet("Brand Name", props.brandName),
            bullet("Strength", props.strength),
            bullet("Dose Form (RxTerms)", props.rxtermsDoseForm),
            bullet("Dose Form (RxNorm)", props.rxnormDoseForm),
            bullet("Route", props.route),
            bullet("Term Type", props.termType),
            bullet("Synonym", props.synonym),
            bullet("Generic RxCUI", props.genericRxcui),
          ].join("")
        );
      } catch (error) {
        return errorResult(describeRxNavError(error, "getting RxTerms info"));
      }
    }
  );
}
