# MCP servers

Each subfolder here is a standalone MCP (Model Context Protocol) server. Copy
`templates/mcp-template/` to start a new one.

Requirements for anything added here:
- No hardcoded API keys/tokens — read all secrets from environment variables and
  document the required variable names in the subfolder's README
- No calls to internal/company-only endpoints — if the original server integrated with
  an internal system, either generalize it to a public API or clearly mark it as an
  example/reference implementation that needs the user's own endpoint
- Setup instructions that work for someone who has never seen your internal stack
