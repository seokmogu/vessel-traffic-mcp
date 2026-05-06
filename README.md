# vessel-traffic-mcp

Read-only MCP server for vessel position and AIS-style maritime data.

The project is intended to connect ChatGPT, Claude, Claude Code, and other MCP clients to authorized vessel data sources through a normalized set of tools:

- Search vessels by name, MMSI, IMO, or callsign.
- Retrieve latest known vessel positions with source/freshness metadata.
- Resolve vessel names from master B/L, house B/L, booking, and arrival-notice text into MMSI/IMO candidates.
- Query vessels in a bounding box or port area.
- Retrieve recent tracks and port-call context when a provider supports it.
- Inspect configured providers, coverage limits, quota status, and data caveats.

## Compliance Boundary

This project does not aim to bypass commercial services. It supports:

- Official APIs and open-data feeds.
- User-provided API credentials and organization-level BYOK credential profiles for paid providers.
- Sanitized HAR/network samples from operator-owned, authorized browser sessions, only where allowed by service terms.

It must not store raw cookies, bearer tokens, API keys, or private HAR files in the repository.

## Initial Commands

```bash
npm install
npm run lint
npm test
npm run build
```

The current MCP core exposes a stdio fixture server through the package binary
`vessel-traffic-mcp`. Operator notes for this surface are in
`docs/runbooks/stdio-fixture-server.md`.

## Autodev

This repository is designed to be driven by `/Users/aktn/project/codex-autodev` using:

```bash
cd /Users/aktn/project/codex-autodev
node bin/codex-autodev.js plan --config configs/vessel-traffic-mcp.json --max-tasks 3 --with-reasoning
node bin/codex-autodev.js run --config configs/vessel-traffic-mcp.json --max-tasks 1
```
