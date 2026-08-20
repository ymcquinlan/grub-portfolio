# LOINC MCP

Gives Claude read-only access to [LOINC](https://loinc.org) — the standard
vocabulary for lab tests and clinical observations — via the official
**LOINC FHIR Terminology Server** (`fhir.loinc.org`).

## Components

| Component  | Details                                                                 |
| ---------- | ------------------------------------------------------------------------ |
| MCP server | `loinc` — bundled Node.js server, runs locally over stdio, no build step |

### Tools

| Tool                 | Description                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `loinc_lookup_code`  | Full details (display name, component, property, system, scale, method, class, status) for a single known LOINC code. |
| `loinc_search_codes` | Free-text search across the full LOINC ontology; returns matching code/display pairs, paginated. |

Both tools are read-only — nothing in LOINC is created, modified, or deleted.

## Setup

Each person who installs this plugin needs **their own** free loinc.org
account — the FHIR server authenticates with HTTP Basic Auth against an
individual username/password (there is no shared API key, and Bitfount does
not provide shared credentials for this).

1. Sign up for a free account at https://loinc.org/join (if you don't already have one).
2. Set two environment variables on your machine, using your own loinc.org username and password:

   **macOS / Linux** (add to `~/.zshrc`, `~/.bashrc`, or similar, then restart your terminal/Claude):

   ```bash
   export LOINC_USERNAME="your-loinc-org-username"
   export LOINC_PASSWORD="your-loinc-org-password"
   ```

   **Windows** (PowerShell, run once, then restart Claude):

   ```powershell
   [System.Environment]::SetEnvironmentVariable("LOINC_USERNAME", "your-loinc-org-username", "User")
   [System.Environment]::SetEnvironmentVariable("LOINC_PASSWORD", "your-loinc-org-password", "User")
   ```

3. Install this plugin and restart Claude Code / the Claude desktop app.

**Do not** put your username/password directly in this plugin's files, in
Slack, or in any shared doc — set them as local environment variables only.
Requests are made straight from your machine to `fhir.loinc.org`; Bitfount
never sees or stores your credentials.

## Usage

Just ask, e.g.:

- "What does LOINC code 2345-7 mean?"
- "Find the LOINC code for hemoglobin A1c"
- "Is LOINC 4548-4 active?"

## Notes and limitations

- Calls the **live** `fhir.loinc.org` service on every request — it does not
  cache or bundle LOINC data locally, so results always reflect the current
  LOINC version served there.
- Only code lookup and free-text search are implemented (no panel/group
  membership or LOINC Part hierarchy navigation).
- Rate limits and quota policy are set by Regenstrief/LOINC, not by this
  plugin — see https://loinc.org/fhir/ for current terms.
- If you see "Authentication failed", double-check `LOINC_USERNAME` /
  `LOINC_PASSWORD` are set correctly and your loinc.org account is active.
