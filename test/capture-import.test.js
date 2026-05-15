import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  importCapture,
  fixtureToJson,
  FIXTURE_FORMAT_VERSION,
} from '../dist/capture/import.js';
import {
  isSensitiveBodyField,
  isSensitiveHeader,
  isSensitiveQueryParam,
  redactValuePatterns,
  createRedactionCounter,
  REDACTED_PLACEHOLDER,
} from '../dist/capture/redact.js';
import { runCli, defaultOutputPath } from '../dist/capture/cli.js';

const SECRET_BEARER = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LWNyZWQtRG8tTm90LUxlYWsifQ.SiGn4tUre-Do-Not-Leak';
const SECRET_API_KEY = 'CAPTURE-AC1-API-KEY-DO-NOT-LEAK-12345678';
const SECRET_COOKIE_VAL = 'sid=CAPTURE-AC1-COOKIE-DO-NOT-LEAK';
const SECRET_PASSWORD = 'CAPTURE-AC1-PW-DO-NOT-LEAK';
const SECRET_BODY_TOKEN = 'CAPTURE-AC1-BODY-TOKEN-DO-NOT-LEAK';
const SECRET_AWS = 'AKIAABCDEFGHIJKLMNOP';

const ALL_SECRETS = [
  SECRET_BEARER,
  SECRET_API_KEY,
  SECRET_COOKIE_VAL,
  SECRET_PASSWORD,
  SECRET_BODY_TOKEN,
  SECRET_AWS,
];

function assertNoSecrets(payload, secrets = ALL_SECRETS) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  for (const secret of secrets) {
    assert.ok(!text.includes(secret), `payload must not contain raw secret "${secret}"`);
  }
}

function buildHarSample() {
  return {
    log: {
      version: '1.2',
      creator: { name: 'test', version: '1.0' },
      entries: [
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
              { name: 'X-Trace', value: `trace-token-with-${SECRET_AWS}-inside` },
            ],
            queryString: [
              { name: 'api_key', value: SECRET_API_KEY },
              { name: 'mmsi', value: '123456789' },
            ],
            cookies: [{ name: 'session', value: SECRET_COOKIE_VAL }],
            postData: {
              mimeType: 'application/json',
              text: JSON.stringify({
                username: 'operator',
                password: SECRET_PASSWORD,
                payload: { token: SECRET_BODY_TOKEN, mmsi: '987654321' },
              }),
            },
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
                positions: [{ mmsi: '123456789', lat: 35.1, lon: 129.0 }],
              }),
            },
          },
        },
        {
          startedDateTime: '2026-05-15T10:00:01.000Z',
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

test('isSensitiveHeader matches known credential headers case-insensitively', () => {
  assert.ok(isSensitiveHeader('Authorization'));
  assert.ok(isSensitiveHeader('authorization'));
  assert.ok(isSensitiveHeader('X-Api-Key'));
  assert.ok(isSensitiveHeader('Set-Cookie'));
  assert.ok(isSensitiveHeader('Cookie'));
  assert.ok(!isSensitiveHeader('Accept'));
  assert.ok(!isSensitiveHeader('Content-Type'));
  assert.ok(!isSensitiveHeader('User-Agent'));
});

test('isSensitiveQueryParam recognizes credential-bearing query keys', () => {
  assert.ok(isSensitiveQueryParam('api_key'));
  assert.ok(isSensitiveQueryParam('apikey'));
  assert.ok(isSensitiveQueryParam('access_token'));
  assert.ok(isSensitiveQueryParam('refresh_token'));
  assert.ok(isSensitiveQueryParam('SubScRiPtIoN_KeY'));
  assert.ok(!isSensitiveQueryParam('mmsi'));
  assert.ok(!isSensitiveQueryParam('imo'));
  assert.ok(!isSensitiveQueryParam('callsign'));
});

test('isSensitiveBodyField recognizes credential body field names', () => {
  assert.ok(isSensitiveBodyField('password'));
  assert.ok(isSensitiveBodyField('refresh_token'));
  assert.ok(isSensitiveBodyField('client_secret'));
  assert.ok(isSensitiveBodyField('cookie'));
  assert.ok(!isSensitiveBodyField('mmsi'));
  assert.ok(!isSensitiveBodyField('positions'));
});

test('redactValuePatterns scrubs JWT and AWS-style tokens', () => {
  const counter = createRedactionCounter();
  const scrubbed = redactValuePatterns(`prefix ${SECRET_BEARER} middle ${SECRET_AWS} tail`, counter);
  assertNoSecrets(scrubbed, [SECRET_BEARER, SECRET_AWS]);
  assert.match(scrubbed, /\[REDACTED\]/);
  assert.ok((counter.valuePatterns.get('jwt') ?? 0) >= 1);
  assert.ok((counter.valuePatterns.get('aws-access-key-id') ?? 0) >= 1);
});

test('importCapture redacts headers, cookies, query params, and body fields from HAR input', () => {
  const har = JSON.stringify(buildHarSample());
  const { fixture, warnings } = importCapture(har, {
    label: 'Marine Traffic Sample!',
    now: () => '2026-05-15T10:00:00.000Z',
  });

  assert.equal(fixture.version, FIXTURE_FORMAT_VERSION);
  assert.equal(fixture.label, 'marine-traffic-sample');
  assert.equal(fixture.source.format, 'har');
  assert.equal(fixture.entries.length, 2);
  assert.deepEqual(warnings, []);

  const serialized = fixtureToJson(fixture);
  assertNoSecrets(serialized);

  const [first, second] = fixture.entries;

  // URL: query string redacted, path preserved.
  assert.match(first.url, /api\.example\.test\/v1\/vessels/);
  assert.match(first.url, /api_key=%5BREDACTED%5D|api_key=\[REDACTED\]/);
  assert.ok(!first.url.includes(SECRET_API_KEY));
  const apiKeyParam = first.queryParams.find((p) => p.name === 'api_key');
  assert.ok(apiKeyParam);
  assert.equal(apiKeyParam.value, REDACTED_PLACEHOLDER);
  const mmsiParam = first.queryParams.find((p) => p.name === 'mmsi');
  assert.equal(mmsiParam.value, '123456789');

  // Headers: sensitive ones redacted, safe ones preserved (with token-pattern scrub).
  const auth = first.request.headers.find((h) => h.name.toLowerCase() === 'authorization');
  assert.equal(auth.value, REDACTED_PLACEHOLDER);
  const accept = first.request.headers.find((h) => h.name === 'Accept');
  assert.equal(accept.value, 'application/json');
  const trace = first.request.headers.find((h) => h.name === 'X-Trace');
  assert.ok(trace.value.includes(REDACTED_PLACEHOLDER));
  assert.ok(!trace.value.includes(SECRET_AWS));

  // Cookies always reduce to [REDACTED] regardless of name.
  for (const cookie of first.request.cookies) {
    assert.equal(cookie.value, REDACTED_PLACEHOLDER);
  }

  // Response Set-Cookie collapses, response body refresh_token collapses.
  const setCookie = first.response.headers.find((h) => h.name.toLowerCase() === 'set-cookie');
  assert.equal(setCookie.value, REDACTED_PLACEHOLDER);
  const respJson = JSON.parse(first.response.body);
  assert.equal(respJson.refresh_token, REDACTED_PLACEHOLDER);
  assert.equal(respJson.ok, true);
  assert.equal(respJson.positions[0].mmsi, '123456789');

  // Request JSON body fields redacted (password + nested token), safe fields kept.
  const reqJson = JSON.parse(first.request.body);
  assert.equal(reqJson.password, REDACTED_PLACEHOLDER);
  assert.equal(reqJson.payload.token, REDACTED_PLACEHOLDER);
  assert.equal(reqJson.payload.mmsi, '987654321');
  assert.equal(reqJson.username, 'operator');

  // Form-encoded body redacts password but keeps username/keep.
  const formParams = new URLSearchParams(second.request.body);
  assert.equal(formParams.get('password'), REDACTED_PLACEHOLDER);
  assert.equal(formParams.get('username'), 'ops');
  assert.equal(formParams.get('keep'), '1');

  // Redaction report counts cover headers, query, body categories.
  const report = fixture.redactionReport;
  assert.ok(report.totalRedactions > 0);
  assert.ok(report.redactedHeaders.length >= 1);
  assert.ok(report.redactedQueryParams.length >= 1);
  assert.ok(report.redactedBodyFields.length >= 1);
});

test('importCapture handles JSON sample input with auto-detect', () => {
  const sample = {
    entries: [
      {
        method: 'GET',
        url: `https://api.example.test/positions?token=${SECRET_API_KEY}`,
        request: {
          headers: { Authorization: `Bearer ${SECRET_BEARER}`, Accept: 'application/json' },
        },
        response: {
          status: 200,
          contentType: 'application/json',
          body: { ok: true, api_key: SECRET_API_KEY, mmsi: '111' },
        },
      },
    ],
  };
  const { fixture } = importCapture(JSON.stringify(sample), { now: () => '2026-05-15T10:00:00.000Z' });
  assert.equal(fixture.source.format, 'json');
  assertNoSecrets(fixtureToJson(fixture));
  const [entry] = fixture.entries;
  const tokenParam = entry.queryParams.find((p) => p.name === 'token');
  assert.equal(tokenParam.value, REDACTED_PLACEHOLDER);
  const auth = entry.request.headers.find((h) => h.name.toLowerCase() === 'authorization');
  assert.equal(auth.value, REDACTED_PLACEHOLDER);
  const respJson = JSON.parse(entry.response.body);
  assert.equal(respJson.api_key, REDACTED_PLACEHOLDER);
  assert.equal(respJson.mmsi, '111');
});

test('importCapture rejects malformed JSON with a clear error', () => {
  assert.throws(() => importCapture('{not json'), /not valid JSON/);
});

test('importCapture rejects JSON that has no recognizable entries', () => {
  assert.throws(
    () => importCapture(JSON.stringify({ unrelated: true })),
    /must be an array of capture entries/,
  );
});

test('importCapture drops base64 response bodies and records a warning', () => {
  const har = {
    log: {
      version: '1.2',
      entries: [
        {
          request: { method: 'GET', url: 'https://api.example.test/blob', headers: [], cookies: [] },
          response: {
            status: 200,
            headers: [],
            cookies: [],
            content: {
              mimeType: 'application/octet-stream',
              encoding: 'base64',
              text: Buffer.from(SECRET_API_KEY, 'utf8').toString('base64'),
            },
          },
        },
      ],
    },
  };
  const { fixture, warnings } = importCapture(JSON.stringify(har), {
    now: () => '2026-05-15T10:00:00.000Z',
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /base64-encoded/);
  const [entry] = fixture.entries;
  assert.equal(entry.response.body, undefined);
  assertNoSecrets(fixtureToJson(fixture), [SECRET_API_KEY]);
});

test('importCapture strips userinfo from URLs', () => {
  const sample = {
    entries: [
      {
        method: 'GET',
        url: `https://operator:${SECRET_PASSWORD}@api.example.test/path`,
      },
    ],
  };
  const { fixture } = importCapture(JSON.stringify(sample), { now: () => '2026-05-15T10:00:00.000Z' });
  const [entry] = fixture.entries;
  assertNoSecrets(entry.url, [SECRET_PASSWORD]);
  assert.ok(!entry.url.includes('operator:'));
});

test('CLI runCli reads HAR from disk, writes sanitized fixture, and refuses to overwrite without --force', async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'capture-import-cli-'));
  try {
    const inputPath = join(tmpRoot, 'sample.har');
    writeFileSync(inputPath, JSON.stringify(buildHarSample()), 'utf8');

    const stdoutChunks = [];
    const stderrChunks = [];
    const env = {
      argv: ['--in', inputPath, '--label', 'cli-fixture', '--format', 'har'],
      cwd: tmpRoot,
      stdout: (text) => stdoutChunks.push(text),
      stderr: (text) => stderrChunks.push(text),
      readFile: (path) => readFileSync(path, 'utf8'),
      writeFile: (path, contents) => writeFileSync(path, contents, 'utf8'),
      ensureDir: (path) => mkdirSync(path, { recursive: true }),
      exists: (path) => existsSync(path),
      now: () => '2026-05-15T10:00:00.000Z',
    };

    const code = await runCli(env);
    assert.equal(code, 0, `expected success, stderr=${stderrChunks.join('')}`);

    const expectedOut = defaultOutputPath(inputPath, 'cli-fixture', tmpRoot);
    assert.ok(existsSync(expectedOut), 'fixture file must be created');

    const fixtureText = readFileSync(expectedOut, 'utf8');
    assertNoSecrets(fixtureText);
    const fixture = JSON.parse(fixtureText);
    assert.equal(fixture.version, FIXTURE_FORMAT_VERSION);
    assert.equal(fixture.label, 'cli-fixture');
    assert.equal(fixture.source.format, 'har');
    assert.equal(fixture.entries.length, 2);
    assert.ok(fixture.redactionReport.totalRedactions > 0);
    assert.ok(stdoutChunks.join('').includes('wrote 2 sanitized entries'));

    // Second run without --force must fail and not modify the file.
    const stderrAfter = [];
    const env2 = { ...env, stderr: (text) => stderrAfter.push(text) };
    const code2 = await runCli(env2);
    assert.equal(code2, 1);
    assert.match(stderrAfter.join(''), /refusing to overwrite/);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('CLI runCli rejects unknown flags with usage', async () => {
  const stdout = [];
  const stderr = [];
  const env = {
    argv: ['--bogus'],
    cwd: '/tmp',
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
    readFile: () => '',
    writeFile: () => {},
    ensureDir: () => {},
    exists: () => false,
    now: () => '2026-05-15T10:00:00.000Z',
  };
  const code = await runCli(env);
  assert.equal(code, 2);
  assert.match(stderr.join(''), /unknown argument "--bogus"/);
});

test('CLI runCli prints help with --help', async () => {
  const stdout = [];
  const env = {
    argv: ['--help'],
    cwd: '/tmp',
    stdout: (text) => stdout.push(text),
    stderr: () => {},
    readFile: () => '',
    writeFile: () => {},
    ensureDir: () => {},
    exists: () => false,
    now: () => '2026-05-15T10:00:00.000Z',
  };
  const code = await runCli(env);
  assert.equal(code, 0);
  const printed = stdout.join('');
  assert.match(printed, /vessel-capture-import/);
  assert.match(printed, /--in <path>/);
  assert.match(printed, /\[REDACTED\]/);
});

test('CLI surfaces errors when the input file is missing', async () => {
  const stderr = [];
  const env = {
    argv: ['--in', '/nonexistent-capture-file-for-test.har'],
    cwd: '/tmp',
    stdout: () => {},
    stderr: (text) => stderr.push(text),
    readFile: () => { throw new Error('should not be called'); },
    writeFile: () => {},
    ensureDir: () => {},
    exists: (path) => path === '/tmp',
    now: () => '2026-05-15T10:00:00.000Z',
  };
  const code = await runCli(env);
  assert.equal(code, 2);
  assert.match(stderr.join(''), /input file not found/);
});

test('package exposes vessel-capture-import bin and capture:import script', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.bin['vessel-capture-import'], './dist/capture/cli.js');
  assert.match(pkg.scripts['capture:import'], /dist\/capture\/cli\.js/);
});

test('runbook documents the CLI redaction guarantees', () => {
  const runbook = readFileSync(
    new URL('../docs/runbooks/capture-fixture-import.md', import.meta.url),
    'utf8',
  );
  assert.match(runbook, /vessel-capture-import/);
  assert.match(runbook, /Authorization/i);
  assert.match(runbook, /Cookie/i);
  assert.match(runbook, /\[REDACTED\]/);
  assert.match(runbook, /never commit raw HAR/i);
});

test('importCapture is deterministic across runs on identical input', () => {
  const har = JSON.stringify(buildHarSample());
  const opts = { label: 'determinism-check', now: () => '2026-05-15T10:00:00.000Z' };
  const a = fixtureToJson(importCapture(har, opts).fixture);
  const b = fixtureToJson(importCapture(har, opts).fixture);
  assert.equal(a, b, 'identical input must produce byte-identical fixture output');
  const parsed = JSON.parse(a);
  const reportKeys = Object.keys(parsed.redactionReport);
  assert.deepEqual(
    reportKeys,
    ['totalRedactions', 'redactedHeaders', 'redactedQueryParams', 'redactedBodyFields', 'redactedValuePatterns'],
    'redaction report must have a stable key order',
  );
  for (const bucket of ['redactedHeaders', 'redactedQueryParams', 'redactedBodyFields', 'redactedValuePatterns']) {
    const names = parsed.redactionReport[bucket].map((e) => e.name);
    const sorted = [...names].sort();
    assert.deepEqual(names, sorted, `${bucket} must be sorted by name for stable diffs`);
  }
});

test('CLI strips operator-private absolute path: fixture stores cwd-relative source', async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'capture-import-relpath-'));
  try {
    const subdir = join(tmpRoot, 'private', 'raw');
    mkdirSync(subdir, { recursive: true });
    const inputPath = join(subdir, 'sample.har');
    writeFileSync(inputPath, JSON.stringify(buildHarSample()), 'utf8');

    const stdout = [];
    const stderr = [];
    const env = {
      argv: ['--in', inputPath, '--label', 'relpath-check'],
      cwd: tmpRoot,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      readFile: (path) => readFileSync(path, 'utf8'),
      writeFile: (path, contents) => writeFileSync(path, contents, 'utf8'),
      ensureDir: (path) => mkdirSync(path, { recursive: true }),
      exists: (path) => existsSync(path),
      now: () => '2026-05-15T10:00:00.000Z',
    };

    const code = await runCli(env);
    assert.equal(code, 0, `expected success, stderr=${stderr.join('')}`);

    const outPath = defaultOutputPath(inputPath, 'relpath-check', tmpRoot);
    const fixture = JSON.parse(readFileSync(outPath, 'utf8'));
    assert.equal(fixture.source.sourceFile, 'private/raw/sample.har',
      'sourceFile must be cwd-relative so operator absolute paths do not leak');
    assert.ok(!fixture.source.sourceFile.startsWith('/'),
      'sourceFile must not be absolute');
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});
