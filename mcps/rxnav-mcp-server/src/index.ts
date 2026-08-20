#!/usr/bin/env node
/**
 * MCP Server for RxNav (NLM's RxNorm, RxClass, and RxTerms REST APIs).
 *
 * RxNav is a free, public NIH/NLM service — no API key or authentication is
 * required. This server exposes drug name normalization, RxCUI lookup,
 * related-drug navigation, NDC mapping, and drug classification as MCP tools.
 *
 * Note: RxNav's Drug-Drug Interaction API was permanently discontinued by
 * NLM on January 2, 2024 and is NOT implemented here. See README.md for
 * details and alternatives.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerRxNormTools } from "./tools/rxnorm.js";
import { registerRxClassTools } from "./tools/rxclass.js";
import { registerRxTermsTools } from "./tools/rxterms.js";

const server = new McpServer({
  name: "rxnav-mcp-server",
  version: "1.0.0",
});

registerRxNormTools(server);
registerRxClassTools(server);
registerRxTermsTools(server);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("rxnav-mcp-server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error starting rxnav-mcp-server:", error);
  process.exit(1);
});
