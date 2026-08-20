/**
 * Shared constants for the RxNav MCP server.
 */

/** Base URL for the RxNorm / RxClass / RxTerms REST APIs. No API key is required. */
export const RXNAV_BASE_URL = "https://rxnav.nlm.nih.gov/REST";

/** Maximum number of characters returned in a single tool response before truncation. */
export const CHARACTER_LIMIT = 25000;

/** Default request timeout, in milliseconds. */
export const REQUEST_TIMEOUT_MS = 15000;
