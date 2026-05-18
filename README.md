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
- **Carrier schedule lookup** by origin/destination, carrier SCAC/name,
  cargo type, direct-only flag, and date windows.
- **Vessel schedule and delay heuristic** for scheduled carrier port
  calls, ETA/ATA variance, and source-attributed delay status.
- **Provider inspection**: coverage limits, quota status, and data
  caveats through the read-only `provider_status` and `data_sources`
  tools.

Every non-fixture result must expose the original service in
`source.provider` and a user-facing source URL in `source.landingUrl`.
Public-page adapters are intended to send users back to the source
service, not to hide or rebrand the data origin.

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
export VESSEL_MCP_PROFILE_MARINETRAFFIC__API_KEY="<your-key>"

# Or, for local development, use the gitignored overlay:
#   config/credential-profiles.local.json
# (this file is in .gitignore and must never be committed)
```

MarineTraffic / Kpler official API support is BYOK-only. With a
MarineTraffic key configured under the `marinetraffic` profile, the
adapter can call the documented `shipsearch`, `exportvessel`,
`exportvesseltrack`, and `portcalls` endpoints for search, latest
position, recent tracks, and recent vessel port calls. Requests should
route with `provider: "marinetraffic"`; if the configured profile label
is not `marinetraffic`, also pass a `credentialProfile` object with
`providerId: "marinetraffic"` and the configured profile label.

See [`docs/runbooks/credential-profiles.md`](./docs/runbooks/credential-profiles.md)
and [`docs/runbooks/operator.md`](./docs/runbooks/operator.md).

### Live-provider tests are opt-in

Live calls are gated behind `VESSEL_MCP_LIVE_TEST_*` flags and are
**skipped by default**. They are never wired into `npm test`,
`npm run lint`, or `npm run build`. See the operator runbook for the
full list of toggles.

### Public capture candidate: ShipFinder

`src/providers/shipfinder.ts` implements the browser-captured ShipFinder
autocomplete and vessel-detail API shapes for explicit use via
`provider: "shipfinder"`. The default server registry remains fixture-only;
public browser endpoints can challenge or throttle non-browser calls, and the
adapter reports those cases as no-data provider states instead of bypassing
verification.

### Public opt-in candidate: MyShipTracking

`src/providers/myshiptracking.ts` implements the browser-captured
MyShipTracking autocomplete, selected-MMSI latest position, and
bounding-box map feed shapes. It remains opt-in for runtime use:

```bash
VESSEL_MCP_ENABLE_PUBLIC_PROVIDERS=myshiptracking npm start
```

The MCP responses include `source.provider = "myshiptracking"` and
`source.landingUrl = "https://www.myshiptracking.com/"` so clients can
display the source service and route users back to it.

### Public opt-in candidate: Carrier schedules

`src/providers/tradlinx.ts` implements the browser-captured FCL/LCL
route schedule endpoints for explicit runtime use:

```bash
VESSEL_MCP_ENABLE_PUBLIC_PROVIDERS=tradlinx npm start
```

Use `carrier_schedule_search` with origin/destination UN/LOCODEs such
as `KRPUS` and `NLRTM`, or known names such as `부산` and `로테르담`.
The adapter returns a user-facing schedule URL in `source.landingUrl`.
Client UIs may show that URL as the source without adding a vendor
display label.

### Local vessel map UI

For a local visual check with ship-name input and a map:

```bash
npm run start:map
```

The UI performs `name/IMO/MMSI -> MMSI -> latest position` through the
MyShipTracking adapter and displays the provider/source URL alongside
the map marker.

### Codex agent setup on another Mac

If you ask a Codex agent on another Mac to set this up, give it this
README section and have it perform these steps. The agent should not
copy private files from another machine and must not commit
`~/.codex/config.toml`.

```bash
cd ~/project
git clone https://github.com/tools-mcp/vessel-traffic-mcp.git
cd vessel-traffic-mcp
npm ci
npm run build
```

Then the agent should add this MCP entry to that Mac's
`~/.codex/config.toml`, replacing the path only if the checkout lives
somewhere else:

```toml
[mcp_servers.vessel-traffic-mcp]
command = "node"
args = ["/absolute/path/to/vessel-traffic-mcp/dist/index.js"]

[mcp_servers.vessel-traffic-mcp.env]
VESSEL_MCP_TRANSPORT = "stdio"
VESSEL_MCP_ENABLE_PUBLIC_PROVIDERS = "myshiptracking,tradlinx"
```

Restart the Codex app after editing the config. In a fresh Codex
session, test with:

```text
EVER GIVEN 현재 위치 조회해줘. 출처 URL도 같이 보여줘.
```

For the browser map UI:

```bash
cd /absolute/path/to/vessel-traffic-mcp
npm run start:map
```

Open `http://127.0.0.1:8787` and search `EVER GIVEN` or MMSI
`353136000`. The UI should display the map marker and a visible
`출처 보기` link to the source service.

Optional MarineTraffic official API setup for the same Codex entry:
add these lines to the existing
`[mcp_servers.vessel-traffic-mcp.env]` table:

```toml
VESSEL_MCP_ENABLE_BYOK_PROVIDERS = "marinetraffic"
VESSEL_MCP_PROFILE_MARINETRAFFIC__API_KEY = "<your local MarineTraffic API key>"
```

Do not commit or paste the real key into repository files. For
MarineTraffic calls, ask the agent to use provider `marinetraffic` and
credential profile label `marinetraffic`.

For schedule lookup, the registered read-only tools are:
`carrier_schedule_search`, `vessel_schedule`, and
`schedule_delay_predict`. The fixture provider supports deterministic
checks such as:

```text
KRPUS에서 NLRTM으로 가는 선사 스케줄을 조회하고, 출처 URL도 같이 보여줘.
EVER GIVEN 선박 스케줄을 조회하고 ETA 지연 여부를 계산해줘.
```

Current schedule-provider candidates are tracked in
[`docs/provider-catalog.md`](./docs/provider-catalog.md): Tradelinx has
an explicit opt-in `carrier_schedule_search` adapter backed by
sanitized browser-captured endpoint shapes documented in
[`docs/runbooks/schedule-api-capture-results.md`](./docs/runbooks/schedule-api-capture-results.md)
while SeaRates, Linescape, IQAX Big Schedules, Routescanner, and
CargoSmart are cataloged for BYOK/API or enterprise review.

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
- [`docs/runbooks/codex.md`](./docs/runbooks/codex.md) — F7.AC3 Codex
  CLI MCP wiring (`~/.codex/config.toml`), Streamable HTTP path, and
  the current Codex plugin manifest / marketplace readiness state.
- [`docs/runbooks/deployment-https.md`](./docs/runbooks/deployment-https.md)
  — Dockerfile and HTTPS reverse-proxy deployment notes for hosting
  the Streamable HTTP MCP endpoint.
- [`docs/runbooks/release-checklist.md`](./docs/runbooks/release-checklist.md)
  — pre-release secret-safety checklist.
- [`docs/runbooks/api-capture-reference-only.md`](./docs/runbooks/api-capture-reference-only.md)
  — F5.AC5 contract: raw `api-capture` sessions, `.env`, cookies, and
  logs are reference-only and must not be imported or committed.
- [`docs/runbooks/capture-execution.md`](./docs/runbooks/capture-execution.md)
  — F5A.AC3 operator runbook for performing an authorized maritime
  capture, promoting a sanitized fixture, and why default autodev/CI
  must never call live paid providers or capture private sessions.
- [`docs/runbooks/browser-api-capture-results.md`](./docs/runbooks/browser-api-capture-results.md)
  — sanitized browser capture results for vessel-name autocomplete,
  IMO/MMSI lookup, detail pages, and latest-position API candidates.
- [`docs/runbooks/schedule-api-capture-results.md`](./docs/runbooks/schedule-api-capture-results.md)
  — sanitized browser capture results for Tradelinx FCL/LCL schedule,
  FCL detail, and vessel schedule API candidates.
- [`docs/discoverability.md`](./docs/discoverability.md) — F7.AC2
  package/repository/documentation discoverability metadata contract
  (npm keywords, GitHub Topics, search surfaces).

## Topics

`vessel-traffic-mcp` is intended to be findable from any of these
MCP and plugin search surfaces. The same set is reflected in the
`package.json` keywords array and is suggested as GitHub Topics on
the repository page. See [`docs/discoverability.md`](./docs/discoverability.md)
for the full contract.

- vessel AIS MCP
- ship tracking MCP
- MarineTraffic MCP
- Claude MCP (Claude Desktop, Claude Code)
- ChatGPT MCP (ChatGPT remote MCP connector)
- Codex plugin (Codex / OpenAI plugin / marketplace workflows)
- MCP / Model Context Protocol server
- AIS / vessel tracking / ship tracking
- BYOK paid-provider routing (MarineTraffic, VesselFinder, AISStream,
  AISHub, Spire, and other catalog entries)

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
