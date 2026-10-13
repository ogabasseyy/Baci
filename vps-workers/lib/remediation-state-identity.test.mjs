import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createRemediationState } from './remediation-state.mjs';

const observedAt = '2026-08-09T10:00:00.000Z';
const candidate = (category) => ({
  caseKey: `vercel:${category}:shared-fingerprint`,
  category,
  fingerprint: 'shared-fingerprint',
  lastSeen: observedAt,
  occurrences: 2,
  source: 'vercel',
});

describe('remediation state canonical identity', () => {
  it('keeps same-fingerprint Vercel categories independently handled', () => {
    const path = join(
      mkdtempSync(join(tmpdir(), 'baci-remediation-identity-')),
      'state.json'
    );
    const runtime = candidate('vercel_runtime_exception');
    const http = candidate('vercel_http_5xx');
    const state = createRemediationState({ path });

    assert.deepEqual(state.pending([runtime, http]), [runtime, http]);
    assert.equal(
      state.complete({
        handledCandidates: [runtime],
        releaseCandidates: [http],
      }),
      true
    );

    assert.deepEqual(createRemediationState({ path }).pending([http]), [http]);
  });

  it('migrates a legacy fingerprint only for the exact stored observation', () => {
    const path = join(
      mkdtempSync(join(tmpdir(), 'baci-remediation-legacy-')),
      'state.json'
    );
    const current = candidate('vercel_runtime_exception');
    writeFileSync(
      path,
      JSON.stringify({
        handled: {
          [current.fingerprint]: {
            observation: '2026-08-09T09:00:00.000Z',
            recordedAt: '2026-08-09T09:01:00.000Z',
          },
        },
        notifications: {},
        reservations: {},
        version: 2,
      })
    );

    const state = createRemediationState({ path });
    assert.deepEqual(state.handledCandidates([current]), []);
    assert.deepEqual(
      state.handledCandidates([
        { ...current, lastSeen: '2026-08-09T09:00:00.000Z' },
      ]),
      [{ ...current, lastSeen: '2026-08-09T09:00:00.000Z' }]
    );
  });
});
