/**
 * Shared response-formatting helpers used across all tools.
 *
 * Every tool supports `response_format: "markdown" | "json"`. This module
 * centralizes the truncation logic and the JSON/Markdown switch so individual
 * tools only need to supply a title and a way to render one item as Markdown.
 */

import { CHARACTER_LIMIT } from "../constants.js";
import { ResponseFormat } from "../types.js";

export interface ToolTextResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/** Wrap a plain error message as a tool error result. */
export function errorResult(message: string): ToolTextResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

/**
 * Build a tool result from structured data, rendering either JSON or the
 * caller-supplied Markdown, and truncating text over CHARACTER_LIMIT.
 */
export function buildResult(
  format: ResponseFormat,
  structured: Record<string, unknown>,
  renderMarkdown: () => string
): ToolTextResult {
  let text: string;
  if (format === ResponseFormat.JSON) {
    text = JSON.stringify(structured, null, 2);
  } else {
    text = renderMarkdown();
  }

  let truncated = false;
  if (text.length > CHARACTER_LIMIT) {
    text =
      text.slice(0, CHARACTER_LIMIT) +
      `\n\n[...output truncated at ${CHARACTER_LIMIT} characters. Narrow your query (e.g. add filters, or request response_format="json" for denser output) to see the rest.]`;
    truncated = true;
  }

  return {
    content: [{ type: "text", text }],
    structuredContent: { ...structured, truncated },
  };
}

/** Render a Markdown bullet list, skipping falsy values. */
export function bullet(label: string, value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  return `- **${label}**: ${value}\n`;
}

/**
 * Generic Markdown table renderer for arrays of flat key/value records, used
 * by the smaller reference/metadata tools where a bespoke renderer isn't
 * worth the code (e.g. NDC status details, reference lists).
 */
export function renderTable<T extends object>(rows: T[], title?: string): string {
  if (rows.length === 0) {
    return title ? `${title}\n\nNo results.` : "No results.";
  }
  const records = rows as unknown as Array<Record<string, unknown>>;
  const columns = Array.from(
    records.reduce((set, row) => {
      Object.keys(row).forEach((k) => set.add(k));
      return set;
    }, new Set<string>())
  );

  const lines: string[] = [];
  if (title) lines.push(`## ${title}`, "");
  lines.push(`| ${columns.join(" | ")} |`);
  lines.push(`| ${columns.map(() => "---").join(" | ")} |`);
  for (const row of records) {
    lines.push(`| ${columns.map((c) => formatCell(row[c])).join(" | ")} |`);
  }
  return lines.join("\n");
}

function formatCell(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value).replace(/\|/g, "\\|");
}
