import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { importCapture, fixtureToJson, FIXTURE_FORMAT_VERSION } from '../dist/capture/import.js';
import {
  buildFingerprints,
  classifySegment,
  breakdownPath,
  FINGERPRINT_FORMAT_VERSION,
} from '../dist/capture/fingerprint.js';
import {
  summarizeBody,
  summarizeJsonValue,
  SCHEMA_FORMAT_VERSION,
} from '../dist/capture/schema.js';
import {
  buildTrafficIR,
  trafficIRToJson,
  TRAFFIC_IR_FORMAT_VERSION,
  FixtureVersionError,
} from '../dist/capture/traffic-ir.js';
import { runIrCli, defaultOutputPath } from '../dist/capture/ir-cli.js';
import { REDACTED_PLACEHOLDER } from '../dist/capture/redact.js';

// Reuse AC1 secret canaries so any leak path that escapes the fixture
// (and any leak path that escapes the IR derivation) is caught.
const SECRET_BEARER = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJpci10ZXN0LWNyZWQtRG8tTm90LUxlYWsifQ.SiGn4tUre-DoNotLeak';
const SECRET_API_KEY = 'IR-AC2-API-KEY-DO-NOT-LEAK-12345678';
const SECRET_COOKIE_VAL = 'sid=IR-AC2-COOKIE-DO-NOT-LEAK';
const SECRET_PASSWORD = 'IR-AC2-PW-DO-NOT-LEAK';
const SECRET_BODY_TOKEN = 'IR-AC2-BODY-TOKEN-DO-NOT-LEAK';
// AC1 AWS pattern requires exactly AKIA + 16 [0-9A-Z]: "IRACAC2DONOTLEAK" is 16 chars.
const SECRET_AWS = 'AKIAIRACAC2DONOTLEAK';

const ALL_SECRETS = [
  SECRET_BEARER,
  SECRET_API_KEY,
  SECRET_COOKIE_VAL,
  SECRET_PASSWORD,
  SECRET_BODY_TOKEN,
  SECRET_AWS,
];

function assertNoSecrets(payload, secrets = ALL_SECRETS, label = 'payload') {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  for (const secret of secrets) {
    assert.ok(!text.includes(secret), `${label} must not contain raw secret "${secret}"`);
  }
}

function buildHarSample() {
  return {
    log: {
      version: '1.2',
      creator: { name: 'test', version: '1.0' },
      entries: [
        // GET /v1/vessels with a vessel-typical mix of query + headers + cookies.
        {
          startedDateTime: '2026-05-15T10:00:00.000Z',
          request: {
            method: 'GET',
            url: `https://api.example.test/v1/vessels?api_key=${SECRET_API_KEY}&mmsi=123456789`,
            headers: [
              { name: 'Authorization', value: `Bearer ${SECRET_BEARER}` },
              { name: 'Cookie', value: SECRET_COOKIE_VAL },
              { name: 'X-Api-Key', value: SECRET_API_KEY },
              { name: 'Accept', value: 'application/json' },
              { name: 'X-Trace', value: `tracewith-${SECRET_AWS}-inside` },
            ],
            cookies: [{ name: 'session', value: SECRET_COOKIE_VAL }],
          },
          response: {
            status: 200,
            statusText: 'OK',
            headers: [
              { name: 'Content-Type', value: 'application/json' },
              { name: 'Set-Cookie', value: `auth=${SECRET_COOKIE_VAL}; Path=/` },
            ],
            cookies: [{ name: 'auth', value: SECRET_COOKIE_VAL }],
            content: {
              size: 100,
              mimeType: 'application/json',
              text: JSON.stringify({
                ok: true,
                refresh_token: SECRET_BEARER,
                positions: [
                  { mmsi: '123456789', lat: 35.1, lon: 129.0 },
                  { mmsi: '987654321', lat: 35.2, lon: 129.1 },
                ],
              }),
            },
          },
        },
        // Same endpoint, different vessel: should fold into one fingerprint.
        {
          startedDateTime: '2026-05-15T10:00:01.000Z',
          request: {
            method: 'GET',
            url: `https://api.example.test/v1/vessels?api_key=${SECRET_API_KEY}&mmsi=987654321`,
            headers: [{ name: 'Accept', value: 'application/json' }],
            cookies: [],
          },
          response: {
            status: 200,
            statusText: 'OK',
            headers: [{ name: 'Content-Type', value: 'application/json' }],
            cookies: [],
            content: {
              size: 100,
              mimeType: 'application/json',
              text: JSON.stringify({
                ok: true,
                refresh_token: SECRET_BEARER,
                positions: [{ mmsi: '987654321', lat: 36.0, lon: 130.5 }],
              }),
            },
          },
        },
        // ID-by-MMSI path: numeric id should collapse to :mmsi placeholder.
        {
          startedDateTime: '2026-05-15T10:00:02.000Z',
          request: {
            method: 'GET',
            url: 'https://api.example.test/v1/vessels/123456789',
            headers: [{ name: 'Accept', value: 'application/json' }],
            cookies: [],
          },
          response: {
            status: 404,
            headers: [{ name: 'Content-Type', value: 'application/json' }],
            cookies: [],
            content: {
              size: 0,
              mimeType: 'application/json',
              text: JSON.stringify({ error: 'not_found' }),
            },
          },
        },
        // POST /v1/login with a sensitive form body — body fields should be redacted in
        // the fixture, and the IR should describe shape only.
        {
          startedDateTime: '2026-05-15T10:00:03.000Z',
          request: {
            method: 'POST',
            url: 'https://api.example.test/v1/login',
            headers: [{ name: 'Content-Type', value: 'application/x-www-form-urlencoded' }],
            cookies: [],
            postData: {
              mimeType: 'application/x-www-form-urlencoded',
              text: `username=ops&password=${encodeURIComponent(SECRET_PASSWORD)}&keep=1`,
            },
          },
          response: {
            status: 204,
            statusText: 'No Content',
            headers: [],
            cookies: [],
            content: { size: 0, mimeType: 'application/json' },
          },
        },
      ],
    },
  };
}

function buildFixture() {
  const har = JSON.stringify(buildHarSample());
  return importCapture(har, { label: 'ir-fixture', now: () => '2026-05-15T10:00:00.000Z' }).fixture;
}

test('format version constants are exported', () => {
  assert.equal(TRAFFIC_IR_FORMAT_VERSION, 1);
  assert.equal(FINGERPRINT_FORMAT_VERSION, 1);
  assert.equal(SCHEMA_FORMAT_VERSION, 1);
});

test('classifySegment recognizes MMSI, IMO, UUID, hex, numeric, redacted', () => {
  assert.deepEqual(classifySegment('123456789'), { placeholder: 'mmsi' });
  assert.deepEqual(classifySegment('9123456'), { placeholder: 'imo' });
  assert.deepEqual(classifySegment('550e8400-e29b-41d4-a716-446655440000'), { placeholder: 'uuid' });
  assert.deepEqual(classifySegment('deadbeefcafebabe1234'), { placeholder: 'hex' });
  assert.deepEqual(classifySegment('42'), { placeholder: 'id' });
  assert.deepEqual(classifySegment('[REDACTED]'), { placeholder: 'redacted' });
  assert.deepEqual(classifySegment(encodeURIComponent('[REDACTED]')), { placeholder: 'redacted' });
  assert.deepEqual(classifySegment('vessels'), { literal: 'vessels' });
});

test('breakdownPath produces canonical templates', () => {
  const bd = breakdownPath('https://api.example.test/v1/vessels/123456789/positions');
  assert.ok(bd);
  assert.equal(bd.origin, 'https://api.example.test');
  assert.equal(bd.pathTemplate, '/v1/vessels/:mmsi/positions');
  assert.equal(bd.rawPath, '/v1/vessels/123456789/positions');
  // Invalid URL returns null.
  assert.equal(breakdownPath('not a url'), null);
});

test('buildFingerprints folds equivalent paths and flags credential query keys', () => {
  const fixture = buildFixture();
  const fps = buildFingerprints(fixture.entries);

  const ids = fps.map((f) => `${f.method} ${f.pathTemplate}`);
  assert.deepEqual(ids.sort(), [
    'GET /v1/vessels',
    'GET /v1/vessels/:mmsi',
    'POST /v1/login',
  ].sort());

  const list = fps.find((f) => f.pathTemplate === '/v1/vessels');
  assert.equal(list.sampleCount, 2, 'two GET /v1/vessels entries must fold into one fingerprint');
  const apiKey = list.queryKeys.find((q) => q.name === 'api_key');
  assert.equal(apiKey.redacted, true, 'api_key must be flagged as redacted');
  const mmsi = list.queryKeys.find((q) => q.name === 'mmsi');
  assert.equal(mmsi.redacted, false, 'mmsi is not a credential and must not be flagged');

  // queryKeys must be sorted by name.
  const names = list.queryKeys.map((q) => q.name);
  assert.deepEqual(names, [...names].sort(), 'queryKeys must be sorted');
  // Sample paths preserved but query string stripped.
  for (const p of list.samplePaths) {
    assert.ok(p.startsWith('/'), 'sample path must start with /');
    assert.ok(!p.includes('?'), 'sample path must not include a query string');
  }

  const id = fps.find((f) => f.pathTemplate === '/v1/vessels/:mmsi');
  assert.equal(id.sampleCount, 1);
});

test('summarizeJsonValue describes shape only and flags [REDACTED]', () => {
  const sample = {
    ok: true,
    refresh_token: REDACTED_PLACEHOLDER,
    positions: [{ mmsi: '123456789', lat: 35.1, lon: 129.0 }],
    counts: 42,
    note: null,
  };
  const schema = summarizeJsonValue(sample);
  assert.equal(schema.kind, 'object');
  assert.equal(schema.properties.ok.kind, 'primitive');
  assert.equal(schema.properties.ok.type, 'boolean');
  assert.equal(schema.properties.refresh_token.kind, 'redacted');
  assert.equal(schema.properties.note.kind, 'primitive');
  assert.equal(schema.properties.note.type, 'null');
  assert.equal(schema.properties.counts.kind, 'primitive');
  assert.equal(schema.properties.counts.type, 'number');
  assert.equal(schema.properties.positions.kind, 'array');
  assert.equal(schema.properties.positions.items.kind, 'object');
  const itemProps = schema.properties.positions.items.properties;
  assert.equal(itemProps.mmsi.type, 'string');
  // Object property keys must be sorted for deterministic output.
  const propKeys = Object.keys(schema.properties);
  assert.deepEqual(propKeys, [...propKeys].sort());
});

test('summarizeJsonValue respects depth, breadth, and union caps', () => {
  // Deep nesting truncation.
  const deep = { a: { b: { c: { d: { e: { f: { g: 'x' } } } } } } };
  const small = summarizeJsonValue(deep, { maxDepth: 2 });
  // a -> object, b -> truncated at depth 2.
  assert.equal(small.properties.a.kind, 'object');
  assert.equal(small.properties.a.properties.b.kind, 'truncated');
  assert.equal(small.properties.a.properties.b.reason, 'depth');

  // Breadth cap.
  const wide = {};
  for (let i = 0; i < 50; i++) wide[`k${String(i).padStart(3, '0')}`] = i;
  const truncated = summarizeJsonValue(wide, { maxBreadth: 5 });
  assert.equal(truncated.kind, 'object');
  assert.equal(truncated.truncated, 'breadth');
  assert.equal(Object.keys(truncated.properties).length, 5);

  // Union cap on heterogeneous arrays.
  const variants = [];
  for (let i = 0; i < 20; i++) variants.push({ [`k${i}`]: 'v' });
  const arr = summarizeJsonValue(variants, { maxUnion: 4 });
  assert.equal(arr.kind, 'array');
  assert.equal(arr.truncatedUnion, true);
  assert.equal(arr.items.kind, 'union');
  assert.ok(arr.items.variants.length <= 4);
});

test('summarizeBody parses JSON, form, and skips unknown mime', () => {
  const json = summarizeBody(JSON.stringify({ a: 1 }), 'application/json');
  assert.equal(json.kind, 'object');
  const form = summarizeBody('a=1&b=2&password=[REDACTED]', 'application/x-www-form-urlencoded');
  assert.equal(form.kind, 'object');
  assert.equal(form.properties.password.kind, 'redacted');
  assert.equal(form.properties.a.kind, 'primitive');
  assert.equal(summarizeBody(undefined, 'application/json'), null);
  assert.equal(summarizeBody('', 'application/json'), null);
});

test('buildTrafficIR rejects non-version-1 fixtures', () => {
  assert.throws(
    () => buildTrafficIR({ version: 99, label: 'x', createdAt: 'now', source: { format: 'json', entryCount: 0 }, entries: [], redactionReport: { totalRedactions: 0, redactedHeaders: [], redactedQueryParams: [], redactedBodyFields: [], redactedValuePatterns: [] }, notes: [] }),
    FixtureVersionError,
  );
});

test('buildTrafficIR emits IR with no secrets and stable structure', () => {
  const fixture = buildFixture();
  // First, double-check the fixture itself is already clean.
  assertNoSecrets(fixtureToJson(fixture), ALL_SECRETS, 'source fixture');

  const ir = buildTrafficIR(fixture, { now: () => '2026-05-15T10:00:00.000Z' });
  assert.equal(ir.version, TRAFFIC_IR_FORMAT_VERSION);
  assert.equal(ir.source.fixtureVersion, FIXTURE_FORMAT_VERSION);
  assert.equal(ir.source.entryCount, fixture.entries.length);
  assert.equal(ir.endpoints.length, 3);

  // No raw credentials end-to-end.
  assertNoSecrets(trafficIRToJson(ir), ALL_SECRETS, 'IR output');

  // Endpoints are sorted by id for stable diffs.
  const ids = ir.endpoints.map((e) => e.id);
  assert.deepEqual(ids, [...ids].sort(), 'endpoints must be sorted by id');

  // GET /v1/vessels: has both api_key (redacted=true) and mmsi (false).
  const list = ir.endpoints.find((e) => e.pathTemplate === '/v1/vessels');
  const apiKey = list.queryKeys.find((q) => q.name === 'api_key');
  assert.equal(apiKey.redacted, true);
  const mmsi = list.queryKeys.find((q) => q.name === 'mmsi');
  assert.equal(mmsi.redacted, false);

  // Header names captured, credential-bearing flagged.
  for (const sensitive of ['Authorization', 'Cookie', 'X-Api-Key']) {
    assert.ok(
      list.redactedHeaderNames.includes(sensitive),
      `redactedHeaderNames must include ${sensitive}`,
    );
  }
  assert.ok(list.requestHeaderNames.includes('Accept'), 'requestHeaderNames must include non-credential headers');

  // Cookies dropped to a count only. No cookie names or values leak.
  assert.equal(typeof list.requestCookieCount, 'number');
  const irText = trafficIRToJson(ir);
  assert.ok(!irText.includes('"requestCookieNames"'), 'IR must not include cookie names');
  // Cookie *value* placeholder is acceptable inside the *fixture*, but our IR
  // should not include the `cookies` array shape at all on the endpoints.
  for (const e of ir.endpoints) {
    assert.equal(e.cookies, undefined, 'IR endpoints must not surface cookie arrays');
  }

  // Status schema: shape only, redacted leaves present.
  const ok = list.statuses.find((s) => s.status === 200);
  assert.ok(ok && ok.schema && ok.schema.kind === 'object');
  assert.equal(ok.schema.properties.refresh_token.kind, 'redacted');
  assert.equal(ok.schema.properties.ok.kind, 'primitive');
  assert.equal(ok.schema.properties.positions.kind, 'array');
  assert.equal(ok.schema.properties.positions.items.kind, 'object');
  // Position items have mmsi:string, lat:number, lon:number.
  const itemProps = ok.schema.properties.positions.items.properties;
  assert.equal(itemProps.mmsi.type, 'string');
  assert.equal(itemProps.lat.type, 'number');
  assert.equal(itemProps.lon.type, 'number');

  // The ID-by-MMSI endpoint must collapse to :mmsi.
  const byId = ir.endpoints.find((e) => e.pathTemplate === '/v1/vessels/:mmsi');
  assert.ok(byId, 'numeric MMSI must collapse to :mmsi placeholder');
  const notFound = byId.statuses.find((s) => s.status === 404);
  assert.ok(notFound);
  assert.equal(notFound.schema.kind, 'object');
  assert.equal(notFound.schema.properties.error.kind, 'primitive');

  // POST /v1/login: form body with password field surfaces as redacted, NOT as raw value.
  const login = ir.endpoints.find((e) => e.pathTemplate === '/v1/login');
  assert.ok(login);
  assert.ok(login.requestBodyMimeTypes.includes('application/x-www-form-urlencoded'));
  const reqSchema = login.requestBodySchema;
  assert.ok(reqSchema && reqSchema.kind === 'object');
  assert.equal(reqSchema.properties.password.kind, 'redacted');
  assert.equal(reqSchema.properties.username.kind, 'primitive');

  // No warnings on a clean fixture.
  assert.deepEqual(ir.warnings, []);
});

test('buildTrafficIR output is byte-identical across repeated runs', () => {
  const fixture = buildFixture();
  const opts = { now: () => '2026-05-15T10:00:00.000Z' };
  const a = trafficIRToJson(buildTrafficIR(fixture, opts));
  const b = trafficIRToJson(buildTrafficIR(fixture, opts));
  assert.equal(a, b, 'IR output must be deterministic for the same input');
});

test('buildTrafficIR defense-in-depth scan rewrites token-shaped path survivors and warns', () => {
  // The fingerprinter retains literal path segments (so callers can audit
  // "what did we capture"). If an importer ever lets a JWT-shaped segment
  // through, the IR must catch and scrub it before writing.
  const fixture = {
    version: FIXTURE_FORMAT_VERSION,
    label: 'leak-canary',
    createdAt: '2026-05-15T10:00:00.000Z',
    source: { format: 'json', sourceFile: 'fabricated', entryCount: 1 },
    entries: [
      {
        method: 'GET',
        // A JWT-shaped path segment (e.g. an embedded session token in URL).
        url: `https://api.example.test/v1/auth/${SECRET_BEARER}/refresh`,
        queryParams: [],
        startedAt: '2026-05-15T10:00:00.000Z',
        request: { headers: [], cookies: [], mimeType: undefined, body: undefined },
        response: {
          status: 200,
          headers: [],
          cookies: [],
          mimeType: 'application/json',
          body: JSON.stringify({ ok: true }),
        },
      },
    ],
    redactionReport: { totalRedactions: 0, redactedHeaders: [], redactedQueryParams: [], redactedBodyFields: [], redactedValuePatterns: [] },
    notes: [],
  };
  const ir = buildTrafficIR(fixture, { now: () => '2026-05-15T10:00:00.000Z' });
  assert.ok(ir.warnings.some((w) => /defense-in-depth/.test(w)), `must surface defense-in-depth warning; warnings=${JSON.stringify(ir.warnings)}`);
  // The serialized IR must not contain the leaked JWT, anywhere.
  const serialized = trafficIRToJson(ir);
  assertNoSecrets(serialized, [SECRET_BEARER], 'defense-in-depth scrubbed IR');
});

test('IR omits cookie names and IR endpoints cap status codes per endpoint', () => {
  const fixture = {
    version: FIXTURE_FORMAT_VERSION,
    label: 'cap-status',
    createdAt: '2026-05-15T10:00:00.000Z',
    source: { format: 'json', entryCount: 0 },
    entries: [],
    redactionReport: { totalRedactions: 0, redactedHeaders: [], redactedQueryParams: [], redactedBodyFields: [], redactedValuePatterns: [] },
    notes: [],
  };
  for (let i = 0; i < 15; i++) {
    fixture.entries.push({
      method: 'GET',
      url: 'https://api.example.test/v1/many-statuses',
      queryParams: [],
      request: { headers: [], cookies: [], mimeType: undefined, body: undefined },
      response: {
        status: 100 + i,
        headers: [],
        cookies: [],
        mimeType: 'application/json',
        body: JSON.stringify({ idx: i }),
      },
    });
  }
  fixture.source.entryCount = fixture.entries.length;
  const ir = buildTrafficIR(fixture, { now: () => '2026-05-15T10:00:00.000Z' });
  const endpoint = ir.endpoints[0];
  assert.ok(endpoint.statuses.length <= 8, 'status codes must be capped per endpoint');
  assert.ok(ir.warnings.some((w) => /distinct response status codes/.test(w)));
});

test('vessel-capture-ir CLI converts a fixture to an IR file and refuses to overwrite', async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'capture-ir-cli-'));
  try {
    const fixture = buildFixture();
    const fixtureDir = join(tmpRoot, 'fixtures', 'captures');
    mkdirSync(fixtureDir, { recursive: true });
    const fixturePath = join(fixtureDir, 'sample.fixture.json');
    writeFileSync(fixturePath, fixtureToJson(fixture), 'utf8');

    const stdout = [];
    const stderr = [];
    const env = {
      argv: ['--in', fixturePath],
      cwd: tmpRoot,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      readFile: (path) => readFileSync(path, 'utf8'),
      writeFile: (path, contents) => writeFileSync(path, contents, 'utf8'),
      ensureDir: (path) => mkdirSync(path, { recursive: true }),
      exists: (path) => existsSync(path),
      now: () => '2026-05-15T10:00:00.000Z',
    };

    const code = await runIrCli(env);
    assert.equal(code, 0, `expected success, stderr=${stderr.join('')}`);

    const expectedOut = defaultOutputPath(fixturePath, tmpRoot);
    assert.ok(existsSync(expectedOut), 'IR file must be created');
    assert.match(expectedOut, /sample\.ir\.json$/);

    const irText = readFileSync(expectedOut, 'utf8');
    assertNoSecrets(irText, ALL_SECRETS, 'CLI-written IR');
    const ir = JSON.parse(irText);
    assert.equal(ir.version, TRAFFIC_IR_FORMAT_VERSION);
    assert.equal(ir.endpoints.length, 3);
    assert.ok(stdout.join('').includes('endpoint(s)'));

    // Second run without --force must fail.
    const stderrAfter = [];
    const code2 = await runIrCli({ ...env, stderr: (text) => stderrAfter.push(text) });
    assert.equal(code2, 1);
    assert.match(stderrAfter.join(''), /refusing to overwrite/);

    // With --force, it succeeds.
    const stderrForce = [];
    const code3 = await runIrCli({ ...env, argv: ['--in', fixturePath, '--force'], stderr: (text) => stderrForce.push(text) });
    assert.equal(code3, 0, `expected success on --force, stderr=${stderrForce.join('')}`);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('vessel-capture-ir CLI rejects raw HAR (not version 1 fixture)', async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'capture-ir-rawhar-'));
  try {
    const harPath = join(tmpRoot, 'raw.har');
    writeFileSync(harPath, JSON.stringify(buildHarSample()), 'utf8');
    const stderr = [];
    const code = await runIrCli({
      argv: ['--in', harPath],
      cwd: tmpRoot,
      stdout: () => {},
      stderr: (text) => stderr.push(text),
      readFile: (path) => readFileSync(path, 'utf8'),
      writeFile: (path, contents) => writeFileSync(path, contents, 'utf8'),
      ensureDir: (path) => mkdirSync(path, { recursive: true }),
      exists: (path) => existsSync(path),
      now: () => '2026-05-15T10:00:00.000Z',
    });
    assert.equal(code, 1);
    assert.match(stderr.join(''), /unsupported fixture version|must contain an "entries" array|capture-ir/);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('vessel-capture-ir CLI prints help and rejects unknown flags', async () => {
  const stdout = [];
  const codeHelp = await runIrCli({
    argv: ['--help'],
    cwd: '/tmp',
    stdout: (t) => stdout.push(t),
    stderr: () => {},
    readFile: () => '',
    writeFile: () => {},
    ensureDir: () => {},
    exists: () => false,
    now: () => '2026-05-15T10:00:00.000Z',
  });
  assert.equal(codeHelp, 0);
  assert.match(stdout.join(''), /vessel-capture-ir/);
  assert.match(stdout.join(''), /--max-depth/);

  const stderr = [];
  const codeBad = await runIrCli({
    argv: ['--bogus'],
    cwd: '/tmp',
    stdout: () => {},
    stderr: (t) => stderr.push(t),
    readFile: () => '',
    writeFile: () => {},
    ensureDir: () => {},
    exists: () => false,
    now: () => '2026-05-15T10:00:00.000Z',
  });
  assert.equal(codeBad, 2);
  assert.match(stderr.join(''), /unknown argument "--bogus"/);
});

test('vessel-capture-ir CLI surfaces error for missing input file', async () => {
  const stderr = [];
  const code = await runIrCli({
    argv: ['--in', '/nonexistent-ir-input.json'],
    cwd: '/tmp',
    stdout: () => {},
    stderr: (t) => stderr.push(t),
    readFile: () => '',
    writeFile: () => {},
    ensureDir: () => {},
    exists: (path) => path === '/tmp',
    now: () => '2026-05-15T10:00:00.000Z',
  });
  assert.equal(code, 2);
  assert.match(stderr.join(''), /input fixture not found/);
});

test('package.json wires vessel-capture-ir bin and capture:ir script', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.bin['vessel-capture-ir'], 'dist/capture/ir-cli.js');
  assert.match(pkg.scripts['capture:ir'], /dist\/capture\/ir-cli\.js/);
});

test('runbook documents IR derivation and redaction guarantees', () => {
  const text = readFileSync(
    new URL('../docs/runbooks/capture-traffic-ir.md', import.meta.url),
    'utf8',
  );
  assert.match(text, /vessel-capture-ir/);
  assert.match(text, /Cookies are dropped/i);
  assert.match(text, /redactedHeaderNames/);
  assert.match(text, /defense-in-depth/i);
});
