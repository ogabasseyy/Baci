import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
import { createRemediationFallbackStore } from './remediation-state-fallback.mjs';
import { remediationStateKeyFor } from './remediation-state-key.mjs';

it('reconciles fallback evidence under the canonical case key', () => {
  const path = join(
    mkdtempSync(join(tmpdir(), 'baci-fallback-')),
    'state.json'
  );
  const candidate = {
    caseKey: 'vercel:vercel_timeout:shared',
    fingerprint: 'shared',
    lastSeen: '2026-08-09T10:00:00.000Z',
  };
  const store = createRemediationFallbackStore(path);
  const state = { handled: {}, reservations: {} };
  store.persist(candidate, '2026-08-09T10:01:00.000Z');

  assert.deepEqual(
    store.reconcile(state, [candidate], '2026-08-09T10:02:00.000Z'),
    [candidate]
  );
  assert.equal(
    state.handled[candidate.caseKey].observation,
    `${candidate.lastSeen}:0`
  );
  store.clear(candidate);
});

it('prunes fallback markers older than the handled retention window', () => {
  const path = join(
    mkdtempSync(join(tmpdir(), 'baci-fallback-prune-')),
    'state.json'
  );
  const candidate = {
    fingerprint: 'expired',
    lastSeen: '2026-06-01T10:00:00.000Z',
  };
  const store = createRemediationFallbackStore(path);
  store.persist(candidate, '2026-06-01T10:01:00.000Z');

  store.reconcile(
    { handled: {}, reservations: {} },
    [],
    '2026-08-09T10:02:00.000Z'
  );

  assert.deepEqual(readdirSync(`${path}.handled-fallback`), []);
});

it('prunes expired partial and invalid-timestamp fallback markers', () => {
  const path = join(
    mkdtempSync(join(tmpdir(), 'baci-fallback-prune-invalid-')),
    'state.json'
  );
  const candidate = {
    fingerprint: 'marker',
    lastSeen: '2026-06-01T10:00:00.000Z',
  };
  const store = createRemediationFallbackStore(path);
  store.persist(candidate, '2026-08-09T10:01:00.000Z');
  const directory = `${path}.handled-fallback`;
  const partial = `${directory}/marker.json.999.tmp`;
  writeFileSync(partial, 'partial');
  utimesSync(
    partial,
    new Date('2026-06-01T10:00:00.000Z'),
    new Date('2026-06-01T10:00:00.000Z')
  );
  writeFileSync(`${directory}/invalid.json`, '{"recordedAt":"not-a-date"}');

  store.reconcile(
    { handled: {}, reservations: {} },
    [],
    '2026-08-09T10:02:00.000Z'
  );

  assert.deepEqual(readdirSync(directory), [
    `${createHash('sha256')
      .update(remediationStateKeyFor(candidate))
      .digest('hex')}.json`,
  ]);
});

it('surfaces a malformed fallback marker instead of treating it as absent', () => {
  const path = join(
    mkdtempSync(join(tmpdir(), 'baci-fallback-read-')),
    'state.json'
  );
  const candidate = {
    fingerprint: 'unreadable',
    lastSeen: '2026-08-09T10:00:00.000Z',
  };
  const store = createRemediationFallbackStore(path);
  store.persist(candidate, '2026-08-09T10:01:00.000Z');
  const marker = `${path}.handled-fallback/${createHash('sha256')
    .update(remediationStateKeyFor(candidate))
    .digest('hex')}.json`;
  writeFileSync(marker, '{not json');

  assert.throws(
    () =>
      store.reconcile(
        { handled: {}, reservations: {} },
        [candidate],
        '2026-08-09T10:02:00.000Z'
      ),
    SyntaxError
  );
});
