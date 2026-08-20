# Portfolio

A collection of Claude skills, MCP servers, and side projects — documented for public reuse.

## Structure

```
skills/       Claude skill (SKILL.md) packages — reusable instruction sets for Claude
mcps/         MCP (Model Context Protocol) servers — tool integrations for Claude/LLMs
projects/     Standalone projects/scripts/apps
```

Each subfolder is self-contained: its own README, its own license note if it differs from the repo default, no dependency on private/internal systems.

## Using anything in here

Every item under `skills/`, `mcps/`, and `projects/` is written to be usable by someone outside this repo's author with no access to any private infrastructure. If you find a reference to an internal service, credential, or company-specific system, please open an issue — that's a bug, not intended behavior.

## Adding a new entry

1. Copy the relevant template from `templates/`
2. Fill in the README, strip any secrets/internal references (see `CONTRIBUTING.md`)
3. Run a secrets scan before committing (see `CONTRIBUTING.md`)
4. Add a one-line entry to this README's index below

## Index

| Name | Type | Description |
|------|------|-------------|
| _(add entries here)_ | | |

## License

MIT — see [LICENSE](LICENSE). Individual subfolders may override this if noted in their own README.
