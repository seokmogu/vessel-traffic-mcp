# TDD: Vessel Traffic MCP Server

## 1. Architecture

```text
MCP client
  -> transport (stdio | streamable-http)
  -> MCP tool handlers
  -> service layer
  -> provider router
  -> provider adapters
  -> official API, open-data feed, fixture, or sanitized capture fixture
```

The server is read-only. Tool handlers validate input, route to provider adapters, normalize output, attach source/freshness metadata, and return structured JSON.

## 2. Runtime

- Node.js 22+
- TypeScript ESM
- `@modelcontextprotocol/sdk`
- `zod` or equivalent runtime validation
- Native `fetch`, WebSocket dependency only if required by provider implementation

## 3. Directory Plan

```text
src/
  index.ts                 # CLI entrypoint
  server/
    create-server.ts       # MCP server construction and tool registration
    transports/
      stdio.ts
      http.ts
  tools/
    vessel-search.ts
    vessel-position.ts
    vessel-area.ts
    vessel-track.ts
    port-calls.ts
    provider-status.ts
  providers/
    types.ts
    router.ts
    registry.ts
    credentials.ts
    fixture.ts
    aisstream.ts
    aishub.ts
    myshiptracking.ts
    commercial/
      marinetraffic.ts
      vesselfinder.ts
      spire.ts
      orbcomm.ts
    barentswatch.ts
    capture-fixture.ts
  resolution/
    extract-document-signals.ts
    vessel-name-normalize.ts
    rank-candidates.ts
  capture/
    site-profile.ts
    recorder.ts
    traffic-ir.ts
    replay-validator.ts
    sanitize-har.ts
    infer-endpoints.ts
  config/
    load-config.ts
  util/
    cache.ts
    rate-limit.ts
    errors.ts
test/
  *.test.js
fixtures/
  sanitized/
```

## 4. Data Model

### VesselIdentity

- `mmsi?: string`
- `imo?: string`
- `name?: string`
- `callsign?: string`
- `flag?: string`
- `type?: string`
- `providerIds?: Record<string, string>`

### VesselPosition

- `identity: VesselIdentity`
- `lat: number`
- `lon: number`
- `speedKnots?: number`
- `courseDeg?: number`
- `headingDeg?: number`
- `navigationStatus?: string`
- `destination?: string`
- `eta?: string`
- `observedAt?: string`
- `retrievedAt: string`
- `freshnessSeconds?: number`
- `staleReason?: string`
- `source: SourceMetadata`

### SourceMetadata

- `provider: string`
- `adapterVersion: string`
- `transport: "api" | "websocket" | "fixture" | "capture-fixture"`
- `coverage?: string`
- `confidence?: "high" | "medium" | "low" | "unknown"`
- `termsNote?: string`

### VesselResolutionCandidate

- `identity: VesselIdentity`
- `score: number`
- `confidence: "high" | "medium" | "low" | "ambiguous"`
- `matchedSignals: string[]`
- `missingSignals: string[]`
- `providerEvidence: SourceMetadata[]`
- `latestPosition?: VesselPosition`
- `needsConfirmation: boolean`

### DocumentVesselSignals

- `rawTextHash: string`
- `candidateNames: string[]`
- `voyageNumbers: string[]`
- `ports: string[]`
- `dates: string[]`
- `carrierNames: string[]`
- `containerNumbers: string[]`
- `explicitIdentifiers: { mmsi?: string; imo?: string; callsign?: string }[]`

## 5. MCP Transport Requirements

### Stdio

- Starts with `vessel-traffic-mcp`.
- Works with local MCP clients.
- Reads provider config from env/config file.
- Does not print secrets.

### Streamable HTTP

- Exposes one MCP endpoint, default `/mcp`.
- Supports optional bearer-token auth.
- Rejects unauthenticated requests when `VESSEL_MCP_AUTH_TOKEN` is configured.
- Exposes `/health` without secrets.

## 6. Provider Requirements

Provider adapters must:

- Return capability metadata.
- Enforce provider rate limits.
- Expose no-data and stale-data states without throwing generic errors.
- Normalize timestamps to ISO 8601 UTC.
- Never log request secrets.
- Support fixture-backed tests.
- Declare credential requirements and supported BYOK modes.
- Return cost/quota hints where the provider charges by credit or subscription quota.

## 7. Credential Requirements

Credential access is separated from provider logic.

Credential sources:

- Environment variables for local/operator profiles.
- Ignored local JSON config for development.
- Future encrypted profile store for hosted multi-user deployments.
- Optional one-time in-memory key for a single call, disabled by default.

Credential code must:

- Redact all secret values from logs, errors, traces, and tool responses.
- Support profile labels rather than raw secret values in normal MCP requests.
- Fail closed when a requested paid provider lacks credentials.
- Avoid writing provider keys to fixtures.

## 8. Vessel Name Resolution Requirements

The resolver should support the B/L workflow where a user uploads a document to ChatGPT or Claude and the model passes extracted text to the MCP server.

Implementation requirements:

- Normalize vessel names by case, punctuation, whitespace, common prefixes/suffixes, and transliteration variants.
- Extract context from text: voyage number, carrier, ports, dates, container numbers, IMO/MMSI/callsign.
- Search provider registries and live providers using exact and fuzzy strategies.
- Rank candidates with transparent evidence and `needsConfirmation` for ambiguity.
- Prefer IMO/MMSI if explicitly present in the document.
- Use recent port-call/track context to disambiguate same-name or renamed vessels.
- Default tests must use fixture documents and fixture provider data.

## 9. Capture Tooling Requirements

`/Users/aktn/project/api-capture` is the local reference implementation for capture orchestration. The vessel project should borrow its architecture:

- Playwright-controlled browser sessions.
- XHR/fetch capture plus HAR backup.
- Append-only event logs for actions and API events.
- Replay validation for endpoint stability and parameter evidence.
- Traffic IR before OpenAPI/provider-adapter generation.
- Supervisor/worker split with deterministic pacing.
- Redaction before sharing, exporting, or committing.

The capture importer must:

- Accept HAR/JSON input from a local file path.
- Refuse to process files containing obvious unsanitized secrets unless `--sanitize-output` is used.
- Redact sensitive headers, cookies, query params, and body fields.
- Produce deterministic sanitized fixtures.
- Generate endpoint fingerprints, traffic IR, and candidate schemas.
- Never produce runnable code that includes captured credentials.

Maritime-specific capture requirements:

- Site profiles must express allowed origins, login/session-loss indicators, safe page scopes, delay/jitter, maximum actions, and forbidden actions.
- Capture workers must avoid destructive account actions, fleet edits, billing pages, password/profile pages, logout, and CAPTCHA workarounds.
- Replay workers must use authorized credentials or browser context only when the user/operator has configured that provider.
- Captured endpoint candidates must be converted into provider-adapter tickets, not automatically enabled for live use.

## 10. Verification Strategy

Default verification:

```bash
npm run lint
npm test
npm run build
```

Optional live checks:

```bash
VESSEL_MCP_LIVE_TESTS=1 npm test -- --test-name-pattern live
```

Live checks must be skipped unless required env vars exist.
