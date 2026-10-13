import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  groupErrorEvents,
  normalizeVercelLogEvent,
  selectRemediationCandidates,
} from './vercel-error-events.mjs';

describe('Vercel review regressions', () => {
  it('prefers a specific error class and does not emit undefined sample fields', () => {
    const event = normalizeVercelLogEvent({
      level: 'error',
      message: 'Error caused by TypeError: invalid value',
      statusCode: undefined,
    });
    const [candidate] = selectRemediationCandidates(groupErrorEvents([event]), {
      minOccurrences: 1,
    });

    assert.equal(candidate.sample.errorClass, 'TypeError');
    assert.equal(candidate.sample.statusCode, '');
    assert.equal('appLocation' in candidate.sample, false);
  });

  it('only classifies the complete phrase "timed out" as a timeout', () => {
    const candidates = selectRemediationCandidates(
      groupErrorEvents([
        { level: 'error', message: 'worker timed outlier', route: '/runtime' },
        { level: 'error', message: 'worker timed out', route: '/timeout' },
      ]),
      { minOccurrences: 1 }
    );

    assert.deepEqual(candidates.map((candidate) => candidate.category).sort(), [
      'vercel_runtime_exception',
      'vercel_timeout',
    ]);
  });
});
