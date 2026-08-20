import { z } from "zod";
import { ResponseFormat } from "../types.js";

/** Shared response_format field, appended to every tool's input schema. */
export const responseFormatField = z
  .nativeEnum(ResponseFormat)
  .default(ResponseFormat.MARKDOWN)
  .describe(
    "Output format: 'markdown' for a human-readable summary, or 'json' for the complete structured data (default: 'markdown')."
  );

/** A single RxCUI (RxNorm Concept Unique Identifier) — always a numeric string. */
export const rxcuiField = z
  .string()
  .regex(/^\d+$/, "rxcui must be a numeric string, e.g. '213269'")
  .describe("RxNorm Concept Unique Identifier (RxCUI), e.g. '213269' for Viagra 25 MG Oral Tablet.");
