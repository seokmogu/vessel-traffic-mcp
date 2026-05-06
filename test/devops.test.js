import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { loadRuntimeConfig } from '../dist/config/runtime.js';
import { redactForLog } from '../dist/util/redact.js';

test('runtime config defaults to stdio and rejects unsupported transports', () => {
  assert.deepEqual(loadRuntimeConfig({}), { transport: 'stdio' });
  assert.deepEqual(loadRuntimeConfig({ VESSEL_MCP_TRANSPORT: 'stdio' }), { transport: 'stdio' });
  assert.throws(
    () => loadRuntimeConfig({ VESSEL_MCP_TRANSPORT: 'http' }),
    /Unsupported VESSEL_MCP_TRANSPORT "http"/,
  );
});

test('startup log redaction masks common credential patterns', () => {
  const message =
    'Authorization: Bearer live-token api_key=abc123 token:xyz Cookie: sid=123 Set-Cookie: session_id=456';
  const redacted = redactForLog(message);

  assert.doesNotMatch(redacted, /live-token|abc123|xyz|sid=123|session_id=456/);
  assert.match(redacted, /Authorization: Bearer \[REDACTED\]/i);
  assert.match(redacted, /api_key=\[REDACTED\]/i);
  assert.match(redacted, /token:\[REDACTED\]/i);
  assert.match(redacted, /Cookie: \[REDACTED\]/i);
  assert.match(redacted, /Set-Cookie: \[REDACTED\]/i);
});

test('CI runs required deterministic verification gates on Node 22', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

  assert.match(workflow, /node-version: '22'/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm run lint/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run build/);
});
