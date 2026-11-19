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
const seed = await readFile(new URL('seed.rb', directory), 'utf8');
const trigger = await readFile(new URL('trigger.rb', directory), 'utf8');
const lostAck = await readFile(new URL('lost-ack.mjs', directory), 'utf8');
const messageLookup = await readFile(
  new URL('message-lookup.mjs', directory),
  'utf8'
);
const ambiguousReconciliation = await readFile(
  new URL('ambiguous-send-reconciliation.mjs', directory),
  'utf8'
);
const runner = await readFile(new URL('run.mjs', directory), 'utf8');

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
  assert.match(
    workflow,
    /wait_for_file harness-ready-for-takeover[\s\S]*?trigger\.rb 'Synthetic customer: I have another question for the human operator\.'/
  );
  assert.match(trigger, /conversation\.messages\.create!/);
  assert.match(trigger, /message_type: :incoming/);
});

test('seed uses a disposable account password accepted by Chatwoot', () => {
  assert.match(seed, /user\.password = 'Synthetic-password-123'/);
});

test('lost-ack integration drops only after a complete upstream response and reconciles through Chatwoot API', () => {
  assert.match(lostAck, /providerResponse\.once\('end'/);
  assert.match(
    lostAck,
    /resolveProviderOutcome\(\{ status: providerStatus \}\)/
  );
  assert.match(lostAck, /clientResponse\.destroy\(\)/);
  assert.match(lostAck, /outcome\.status >= 200 && outcome\.status < 300/);
  assert.match(messageLookup, /url\.searchParams\.set\('before', before\)/);
  assert.match(messageLookup, /AbortSignal\.timeout/);
  assert.match(ambiguousReconciliation, /reconcileAmbiguousSend\(/);
  assert.match(ambiguousReconciliation, /request was not retried/);
  assert.match(lostAck, /assert\.equal\(postCount, 1/);
  assert.match(runner, /verifyLostAckMessageReconciliation/);
});
