# rxnav-mcp-server

An MCP (Model Context Protocol) server for [RxNav](https://lhncbc.nlm.nih.gov/RxNav/), the U.S. National Library of Medicine's suite of drug terminology REST APIs. It exposes drug name normalization, RxCUI lookup, related-drug navigation, NDC (National Drug Code) mapping, and drug classification as MCP tools an LLM agent can call directly.

RxNav is free and public — **no API key, account, or authentication is required.** Usage is subject to NLM's [Terms of Service](https://lhncbc.nlm.nih.gov/RxNav/TermsofService.html).

## What's covered

- **RxNorm API** — resolve drug names to RxCUIs, fuzzy/spelling-corrected matching, full drug-product search by ingredient/brand, concept properties, related concepts (ingredients, brands, dose forms), NDC lookup/status/history, RxCUI lifecycle status, and RxNorm's reference/metadata lists.
- **RxClass API** — find drug classes by name, get every class a drug belongs to (ATC, VA, FDA Established Pharmacologic Class, mechanism of action, physiologic effect, disease relationships, and more), get the drugs in a class, navigate class hierarchies, and find classes with similar drug membership.
- **RxTerms API** — NLM's curated, prescription-UI-friendly subset of RxNorm (clean display names, dose forms, strengths).

### Not covered: the Drug-Drug Interaction API

RxNav's Drug-Drug Interaction API (`/REST/interaction/*`) was **permanently discontinued by NLM on January 2, 2024** — the endpoints now return HTTP 404. It is not implemented here because there is nothing left to wrap. If your use case needs interaction checking, look at commercial/licensed sources (e.g. First Databank, Multum, Lexicomp) or DrugBank's own interaction data (RxNav's old interaction feature drew on DrugBank's non-commercial dataset, among others). See NLM's own note: https://lhncbc.nlm.nih.gov/RxNav/information/FAQs.html

## Installation

```bash
npm install
npm run build
```

This produces `dist/index.js`, a stdio MCP server.

## Running

```bash
npm start
# or directly:
node dist/index.js
```

### Using with Claude Desktop / Claude Code

Add to your MCP client's config (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "rxnav": {
      "command": "node",
      "args": ["/absolute/path/to/rxnav-mcp-server/dist/index.js"]
    }
  }
}
```

No environment variables are required.

### Inspecting tools interactively

```bash
npm run inspect
```

This launches the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) against the built server.

## Tools

Every tool accepts an optional `response_format` parameter (`"markdown"` default, or `"json"` for the full structured payload).

### RxNorm

| Tool | Purpose |
|---|---|
| `rxnav_find_rxcui` | Resolve a drug name, or an external ID (NDC, UPC, SNOMED CT, etc.), to RxCUI(s). Usually the first call in any workflow. |
| `rxnav_get_approximate_match` | Fuzzy-match messy/misspelled free text to ranked RxCUI candidates. |
| `rxnav_get_spelling_suggestions` | Suggest corrected drug name spellings. |
| `rxnav_search_drugs` | Find every product/form/strength for an ingredient or brand, grouped by term type. |
| `rxnav_get_concept_properties` | Get a concept's name/TTY/synonym, or its full attribute dump. |
| `rxnav_get_related_concepts` | Get concepts related to an RxCUI — full graph, or filtered by term type / relationship name. |
| `rxnav_get_ndcs` | Get NDCs for a drug product RxCUI. |
| `rxnav_get_ndc_properties` | Get packaging/property detail for a specific NDC. |
| `rxnav_get_ndc_status` | Check whether an NDC is active/obsolete/alien, and what it maps to. |
| `rxnav_find_related_ndcs` | Find other NDCs related to a given NDC (same concept / product / drug). |
| `rxnav_get_historical_ndcs` | Get every NDC ever associated with a concept, including retired ones. |
| `rxnav_get_rxcui_history_status` | Check an RxCUI's lifecycle status (active/obsolete/remapped). |
| `rxnav_filter_by_property` | Test whether a concept matches a property filter (e.g. TTY in a set). |
| `rxnav_get_reference_data` | Get RxNorm's fixed reference lists (id types, term types, property names, relationship types, source vocabularies). |
| `rxnav_get_version` | Get the current RxNorm dataset/API version. |

### RxClass

| Tool | Purpose |
|---|---|
| `rxnav_find_drug_classes_by_name` | Search all classification systems for a class by name. |
| `rxnav_get_drug_classes` | Get every class a drug belongs to (by RxCUI or name), optionally scoped to a relationship source/name and filtered by classification system. |
| `rxnav_get_class_members` | Get the drugs that belong to a given class. |
| `rxnav_get_class_hierarchy` | Walk a hierarchical classification tree (MeSH Pharmacologic Action, ATC1-4, VA) up (ancestors) or down (descendants). |
| `rxnav_get_similar_classes` | Find classes with similar drug membership to a class or an ad hoc RxCUI list, ranked by an equivalence score. |
| `rxnav_get_class_reference_data` | Get RxClass's fixed reference lists (classification systems, relationship names, relationship sources). |

### RxTerms

| Tool | Purpose |
|---|---|
| `rxnav_get_rxterms_info` | Get the curated, prescription-UI-friendly record for a drug product (display name, dose form, strength, route). |

## Typical workflow

1. `rxnav_find_rxcui` (or `rxnav_get_approximate_match` for messy input) to get an RxCUI from a name.
2. `rxnav_search_drugs` / `rxnav_get_related_concepts` to explore forms, strengths, and brands.
3. `rxnav_get_ndcs` / `rxnav_get_ndc_properties` / `rxnav_get_ndc_status` to cross-reference to/from NDCs.
4. `rxnav_get_drug_classes` / `rxnav_get_class_members` to work with therapeutic/pharmacologic classifications.

## Project structure

```
rxnav-mcp-server/
├── package.json
├── tsconfig.json
├── evaluation.xml        # 10 QA pairs for the mcp-builder evaluation harness
├── src/
│   ├── index.ts          # entry point, stdio transport
│   ├── types.ts          # shared response-shape interfaces
│   ├── constants.ts      # base URL, timeouts, character limit
│   ├── tools/
│   │   ├── rxnorm.ts
│   │   ├── rxclass.ts
│   │   └── rxterms.ts
│   ├── services/
│   │   ├── rxnav-client.ts   # shared axios client + error formatting
│   │   ├── format.ts         # response_format handling, truncation, tables
│   │   └── generic.ts        # best-effort parsing for thinly-documented list endpoints
│   └── schemas/
│       └── common.ts     # shared Zod fields (rxcui, response_format)
└── dist/                 # build output (npm run build)
```

## Notes on data accuracy

RxClass in particular has several parameters that vary in required-ness by endpoint (e.g. `class/similar` requires `relaSource` and `rela`, while `class/similarByRxcuis` treats both as optional). Every tool here was checked against RxNav's live JSON responses during development, not just its documentation prose — but RxNav is a NIH service outside our control, and its response shapes have occasionally changed across versions. If a tool starts returning unexpectedly empty results, `rxnav_get_version` and the reference-data tools are good first checks.

## Evaluation

`evaluation.xml` contains 10 read-only QA pairs suitable for the `mcp-builder` skill's evaluation harness (`scripts/evaluation.py`):

```bash
python scripts/evaluation.py -t stdio -c node -a dist/index.js evaluation.xml
```

## License

MIT
