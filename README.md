# vessel-traffic-mcp

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

A read-only **Model Context Protocol (MCP) server** for vessel position
and AIS-style maritime data — designed to connect ChatGPT, Claude,
Claude Code, Codex, and other MCP clients to authorized vessel data
sources through a normalized set of tools.

Open source under the [MIT license](./LICENSE). Pre-1.0; APIs and tool
surfaces may change.

## What it does

- **Search** vessels by name, MMSI, IMO, or callsign.
- **Latest position** with `source`, `retrievedAt`, `observedAt`,
  freshness, coverage, and confidence metadata on every response.
- **Vessel-name resolution** from master B/L, house B/L, booking, and
  arrival-notice text into ranked MMSI/IMO candidates with evidence
  and explicit `needsConfirmation` when ambiguous.
- **Bounding-box and port-area** queries.
- **Recent tracks and port-call** context when a provider supports it.
- **Provider inspection**: coverage limits, quota status, and data
  caveats through the read-only `provider_status` and `data_sources`
  tools.

The server speaks **stdio** for local Claude Desktop/Claude Code use
and **Streamable HTTP** at `/mcp` (with a public `/health`) for remote
ChatGPT/Claude connector use.

## Why it's open source

Maritime data discovery is fragmented across free terrestrial AIS
feeds, regional open-data portals, and paid satellite/commercial APIs.
This project provides a vendor-neutral MCP shim so MCP clients can
query "vessel AIS MCP", "ship tracking MCP", "MarineTraffic MCP",
"Claude MCP", "ChatGPT MCP", and "Codex plugin" workflows through one
normalized interface — without bundling any one vendor's account or
data into the project.

## Compliance Boundary

This project does **not** aim to bypass commercial services. It
supports:

- Official APIs and open-data feeds.
- User-provided API credentials and organization-level BYOK credential
  profiles for paid providers.
- Sanitized HAR/network samples from operator-owned, authorized
  browser sessions, only where allowed by service terms.

It must not store raw cookies, bearer tokens, API keys, or private
HAR files in the repository. The full hard-rule list lives in
[`AGENTS.md`](./AGENTS.md), and security expectations are in
[`SECURITY.md`](./SECURITY.md).

> **Not for navigation.** AIS data returned by configured providers
> may be delayed, incomplete, or inaccurate. This project is not a
> safety-critical navigation tool.

## Quick start (fixture-only, no credentials needed)

```bash
git clone <this-repo>
cd vessel-traffic-mcp
npm install
npm run lint
npm test
npm run build
```

The default verification gate uses the local fixture provider and
sanitized fixtures only. It does not call paid or live providers, and
it does not require API keys, accounts, or network access.

### Stdio (local) — safe example

```bash
# Start the stdio MCP server from the package binary.
VESSEL_MCP_TRANSPORT=stdio npm start
```

In Claude Desktop / Claude Code / MCP Inspector, point the client at
the `vessel-traffic-mcp` binary. See
[`docs/runbooks/stdio-fixture-server.md`](./docs/runbooks/stdio-fixture-server.md)
for the full client configuration.

### Streamable HTTP (remote) — safe example

```bash
# Public /health, bearer-auth-gated /mcp.
export VESSEL_MCP_TRANSPORT=http
export VESSEL_MCP_HTTP_HOST=127.0.0.1
export VESSEL_MCP_HTTP_PORT=8765
export VESSEL_MCP_AUTH_TOKEN="<a-strong-random-token-you-generated>"
npm run start:http

# Health probe (no auth):
curl -sf "http://127.0.0.1:8765/health"

# MCP requests require Authorization: Bearer <token>.
# Do not paste real tokens into chat; use a local env file.
```

See [`docs/runbooks/streamable-http-server.md`](./docs/runbooks/streamable-http-server.md).

### BYOK paid providers — safe example

Paid providers are accessed through **redacted credential profiles**.
Raw keys never appear in logs, errors, or MCP tool responses; only the
profile label and status are exposed.

```bash
# Env-var form (preferred): VESSEL_MCP_PROFILE_<LABEL>__<FIELD>
export VESSEL_MCP_PROFILE_MYTEAM__MARINETRAFFIC_API_KEY="<your-key>"

# Or, for local development, use the gitignored overlay:
#   config/credential-profiles.local.json
# (this file is in .gitignore and must never be committed)
```

See [`docs/runbooks/credential-profiles.md`](./docs/runbooks/credential-profiles.md)
and [`docs/runbooks/operator.md`](./docs/runbooks/operator.md).

### Live-provider tests are opt-in

Live calls are gated behind `VESSEL_MCP_LIVE_TEST_*` flags and are
**skipped by default**. They are never wired into `npm test`,
`npm run lint`, or `npm run build`. See the operator runbook for the
full list of toggles.

## Project layout

```
src/
  capture/      # sanitized capture fixture importer + traffic IR CLI
  config/       # credential profile loader, provider catalog
  providers/    # adapter interfaces, registry, router, rate limit, TTL cache
  server/       # MCP transports (stdio, streamable HTTP), tool handlers
  tools/        # tool definitions (read-only)
  util/         # structured logging, redaction helpers
test/           # node:test deterministic tests; fixture-backed
docs/
  PRD.md, TDD.md, provider-catalog.md
  runbooks/     # operator, transports, BYOK, capture, release-checklist
```

## Documentation

- [`AGENTS.md`](./AGENTS.md) — project hard rules.
- [`docs/PRD.md`](./docs/PRD.md) — product requirements.
- [`docs/TDD.md`](./docs/TDD.md) — technical design.
- [`docs/provider-catalog.md`](./docs/provider-catalog.md) — provider
  inventory and routing policy.
- [`docs/runbooks/operator.md`](./docs/runbooks/operator.md) —
  end-to-end operator runbook (credentials, rate limits, live-test
  toggles, client setup).
- [`docs/runbooks/clients.md`](./docs/runbooks/clients.md) — client
  setup for Claude Desktop, Claude Code, ChatGPT remote MCP, and the
  generic MCP Inspector.
- [`docs/runbooks/deployment-https.md`](./docs/runbooks/deployment-https.md)
  — Dockerfile and HTTPS reverse-proxy deployment notes for hosting
  the Streamable HTTP MCP endpoint.
- [`docs/runbooks/release-checklist.md`](./docs/runbooks/release-checklist.md)
  — pre-release secret-safety checklist.
- [`docs/runbooks/api-capture-reference-only.md`](./docs/runbooks/api-capture-reference-only.md)
  — F5.AC5 contract: raw `api-capture` sessions, `.env`, cookies, and
  logs are reference-only and must not be imported or committed.

## Contributing

Contributions are welcome. Please read [`CONTRIBUTING.md`](./CONTRIBUTING.md)
first — the project has non-negotiable safety rules around
credentials, capture fixtures, and the read-only contract.

## Security

Do not file a public GitHub issue for a suspected vulnerability. See
[`SECURITY.md`](./SECURITY.md) for the private reporting channel.

## Autodev

This repository is designed to be driven by `/Users/aktn/project/codex-autodev` using:

```bash
cd /Users/aktn/project/codex-autodev
node bin/codex-autodev.js plan --config configs/vessel-traffic-mcp.json --max-tasks 3 --with-reasoning
node bin/codex-autodev.js run --config configs/vessel-traffic-mcp.json --max-tasks 1
```

## License

[MIT](./LICENSE) — see the license for the full text, including the
no-warranty and not-for-navigation notices.
