import assert from 'node:assert/strict';
import { it } from 'node:test';
import { normalizeRemediationNotifications } from './remediation-state-notifications.mjs';

it('keeps validated report fields and valid retry scheduling fields', () => {
  const report = {
    html: '<p>x</p>',
    providerToken: 'must-not-persist',
    subject: 'x',
    text: 'x',
  };
  const normalizedReport = { html: '<p>x</p>', subject: 'x', text: 'x' };

  assert.deepEqual(
    normalizeRemediationNotifications({
      deferred: {
        attempts: 2,
        nextAttemptAt: '2026-08-09T10:01:00.000Z',
        recordedAt: '2026-08-09T10:00:00.000Z',
        report,
      },
      legacy: {
        recordedAt: '2026-08-09T10:00:00.000Z',
        report,
      },
      malformed: { recordedAt: 'not-a-date', report },
    }),
    {
      deferred: {
        attempts: 2,
        nextAttemptAt: '2026-08-09T10:01:00.000Z',
        recordedAt: '2026-08-09T10:00:00.000Z',
        report: normalizedReport,
      },
      legacy: {
        recordedAt: '2026-08-09T10:00:00.000Z',
        report: normalizedReport,
      },
    }
  );
});

it('drops invalid retry metadata while retaining a valid notification', () => {
  const report = { html: '<p>x</p>', subject: 'x', text: 'x' };

  assert.deepEqual(
    normalizeRemediationNotifications({
      invalid: {
        attempts: -1,
        nextAttemptAt: 'soon',
        recordedAt: '2026-08-09T10:00:00.000Z',
        report,
      },
    }),
    { invalid: { recordedAt: '2026-08-09T10:00:00.000Z', report } }
  );
});
