# mcp-name-here

One-line description of what this MCP server exposes (e.g. "Tools for reading/writing
issues on a self-hosted Gitea instance").

## Tools provided

| Tool | Description |
|------|-------------|
| `tool_name` | what it does |

## Setup

```bash
npm install   # or: pip install -r requirements.txt
```

### Required environment variables

| Variable | Description |
|----------|--------------|
| `EXAMPLE_API_KEY` | API key for the target service. Get one from ... |

Never commit a `.env` file. Copy `.env.example` to `.env` and fill in your own values locally.

## Running

```bash
node index.js   # or: python server.py
```

## Adding to Claude

Example config snippet for `claude_desktop_config.json` / Claude Code MCP config, using
env var placeholders only — no real keys.
