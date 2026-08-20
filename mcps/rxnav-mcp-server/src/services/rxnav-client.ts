/**
 * Shared HTTP client for all RxNav REST API families (RxNorm, RxClass, RxTerms).
 *
 * RxNav requires no API key. Every endpoint accepts an optional `.json` suffix;
 * we always request JSON explicitly via the Accept header and by appending
 * `.json` to the path so error/empty responses stay predictable.
 */

import axios, { AxiosError } from "axios";
import { RXNAV_BASE_URL, REQUEST_TIMEOUT_MS } from "../constants.js";

const client = axios.create({
  baseURL: RXNAV_BASE_URL,
  timeout: REQUEST_TIMEOUT_MS,
  headers: {
    Accept: "application/json",
  },
});

/**
 * Perform a GET request against a RxNav REST path.
 *
 * @param path - Path relative to the API base, WITHOUT a leading slash and
 *   WITHOUT a `.json` extension (it is appended automatically), e.g. `"rxcui"`
 *   or `"rxcui/213269/ndcs"`.
 * @param params - Query string parameters. Undefined/empty values are omitted.
 */
export async function rxnavGet<T>(
  path: string,
  params: Record<string, string | number | undefined> = {}
): Promise<T> {
  const cleanParams: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      cleanParams[key] = value;
    }
  }

  const response = await client.get<T>(`/${path}.json`, { params: cleanParams });
  return response.data;
}

/**
 * Translate a thrown error from an RxNav request into a clear, actionable
 * message for the calling agent. Never leaks stack traces or internal detail.
 */
export function describeRxNavError(error: unknown, context: string): string {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError;
    const status = axiosError.response?.status;
    switch (status) {
      case 400:
        return `Error: RxNav rejected the request while ${context} (400 Bad Request). Double-check the identifier or parameter values you supplied.`;
      case 404:
        return `Error: RxNav found nothing while ${context} (404 Not Found). The identifier may not exist, or may have been retired — try rxnav_get_rxcui_history_status or rxnav_find_rxcui to confirm.`;
      case 429:
        return `Error: RxNav rate limit exceeded while ${context} (429 Too Many Requests). Wait a few seconds before retrying, and consider batching fewer calls.`;
      case 500:
      case 502:
      case 503:
        return `Error: RxNav's server had a problem while ${context} (HTTP ${status}). This is usually transient — retry in a moment.`;
      default:
        if (axiosError.code === "ECONNABORTED") {
          return `Error: Request to RxNav timed out while ${context}. RxNav may be slow right now — retry, or narrow the request.`;
        }
        return `Error: RxNav request failed while ${context}${status ? ` (HTTP ${status})` : ""}: ${axiosError.message}`;
    }
  }
  return `Error: Unexpected error while ${context}: ${error instanceof Error ? error.message : String(error)}`;
}
