import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const directory = new URL('.', import.meta.url);
const compose = await readFile(new URL('compose.yml', directory), 'utf8');
const workflow = await readFile(
  new URL(
    '../../../../.github/workflows/chatwoot-synthetic-handoff.yml',
    import.meta.url
  ),
  'utf8'
);
const harness = await readFile(new URL('run.mjs', directory), 'utf8');

test('pins service images and keeps the Compose network unpublished and internal', () => {
  assert.match(
    compose,
    /chatwoot\/chatwoot:v4\.19\.1@sha256:04895c7bd0550d9e74b45b7202787b56f7ee4e891ebbde0c429c8c32901b97cf/
  );
  assert.match(
    compose,
    /pgvector\/pgvector:pg16@sha256:0dd3149a06e4579a0d70d8fef9945636cd514005e7237deb27f9b67886f8dc4f/
  );
  assert.match(
    compose,
    /redis:7\.4-alpine@sha256:8da19c7399dca900c6822a1cf30f9d2285585e2c4b457ff4095b0f4500054d3f/
  );
  assert.match(
    compose,
    /node:22-alpine@sha256:025b8e975a61d94e33abeafaad1255ef44e4898cf1a1b6446860009c72e6d284/
  );
  assert.match(compose, /internal: true/);
  assert.match(compose, /SAFE_FETCH_ALLOW_PRIVATE_NETWORK: "true"/);
  assert.doesNotMatch(compose, /^\s+ports:/m);
});

test('workflow uses read-only permissions, bounded runs, pull-first and unconditional cleanup', () => {
  assert.match(workflow, /permissions:\n {2}contents: read/);
  assert.match(workflow, /timeout-minutes: 25/);
  assert.match(
    workflow,
    /docker compose .* pull postgres redis rails sidekiq harness/
  );
  assert.match(workflow, /trap cleanup EXIT/);
  assert.match(workflow, /down --volumes --remove-orphans/);
});

test('harness covers bot handoff, human attribution and resumed bot reply through APIs', () => {
  assert.match(harness, /toggle_status/);
  assert.match(harness, /status: 'open'/);
  assert.match(harness, /status: 'pending'/);
  assert.match(harness, /senderKind\(human\.sender\) !== 'user'/);
  assert.match(harness, /senderKind\(item\.sender\) === 'agentbot'/);
  assert.match(harness, /message_type !== 'incoming'/);
  assert.match(harness, /harness-ready-for-followup/);
  assert.match(harness, /handedBack\.status !== 'pending'/);
});
