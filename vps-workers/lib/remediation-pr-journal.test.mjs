import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createRemediationPrJournal } from './remediation-pr-journal.mjs';

describe('remediation PR journal', () => {
  it('persists bounded PR recovery data before a lifecycle checkpoint', () => {
    const path = join(
      mkdtempSync(join(tmpdir(), 'baci-pr-journal-')),
      'journal.json'
    );
    const journal = createRemediationPrJournal({
      now: () => Date.parse('2026-08-09T10:01:00.000Z'),
      path,
    });
    journal.record({
      candidate: {
        caseKey: 'vercel:vercel_runtime_exception:journal-1',
        fingerprint: 'journal-1',
        lastSeen: '2026-08-09T10:00:00.000Z',
        observationMarker: '2026-08-09T10:00:00.000Z',
      },
      result: {
        branch: 'codex/fix-journal-1',
        prUrl: 'https://github.com/baci/baci/pull/77',
        type: 'pr_opened',
      },
    });

    assert.deepEqual(journal.entries(), [
      {
        at: '2026-08-09T10:01:00.000Z',
        branch: 'codex/fix-journal-1',
        caseKey: 'vercel:vercel_runtime_exception:journal-1',
        fingerprint: 'journal-1',
        observation: '2026-08-09T10:00:00.000Z',
        prUrl: 'https://github.com/baci/baci/pull/77',
        type: 'pr_opened',
      },
    ]);
    assert.doesNotMatch(readFileSync(path, 'utf8'), /Alice|secret/i);
  });

  it('fails closed for malformed journal content instead of dropping recovery', () => {
    const path = join(
      mkdtempSync(join(tmpdir(), 'baci-pr-journal-invalid-')),
      'journal.json'
    );
    const journal = createRemediationPrJournal({ path });

    for (const content of [
      '{not json',
      JSON.stringify({ entries: [] }),
      JSON.stringify([{ caseKey: 'missing-required-fields' }]),
    ]) {
      writeFileSync(path, content);
      assert.throws(() => journal.entries(), /Invalid remediation PR journal/);
    }
  });

  it('separates JSON parse failures from semantic journal validation', () => {
    const path = join(
      mkdtempSync(join(tmpdir(), 'baci-pr-journal-errors-')),
      'journal.json'
    );
    const journal = createRemediationPrJournal({ path });
    writeFileSync(path, '{not json');

    assert.throws(
      () => journal.entries(),
      (error) =>
        error.message.includes('Invalid remediation PR journal JSON') &&
        error.cause instanceof SyntaxError
    );
    writeFileSync(path, JSON.stringify([{ caseKey: 'missing-fields' }]));

    assert.throws(
      () => journal.entries(),
      (error) =>
        error.message.includes('Invalid remediation PR journal schema') &&
        error.cause === undefined
    );
  });

  it('fails closed for semantically invalid PR journal entries', () => {
    const path = join(
      mkdtempSync(join(tmpdir(), 'baci-pr-journal-semantic-')),
      'journal.json'
    );
    const journal = createRemediationPrJournal({ path });
    const valid = {
      at: '2026-08-09T10:01:00.000Z',
      branch: 'codex/fix-journal-1',
      caseKey: 'vercel:vercel_runtime_exception:journal-1',
      fingerprint: 'journal-1',
      observation: '2026-08-09T10:00:00.000Z',
      prUrl: 'https://github.com/baci/baci/pull/77',
      type: 'pr_opened',
    };

    for (const entry of [
      { ...valid, type: 'no_changes' },
      { ...valid, branch: '' },
      { ...valid, caseKey: '' },
      { ...valid, fingerprint: '' },
      { ...valid, observation: '' },
      { ...valid, prUrl: '' },
      { ...valid, at: 'not-a-timestamp' },
      { ...valid, fingerprint: 'different-fingerprint' },
      { ...valid, unexpected: 'field' },
    ]) {
      writeFileSync(path, JSON.stringify([entry]));
      assert.throws(() => journal.entries(), /Invalid remediation PR journal/);
    }
    const mismatch = { ...valid, fingerprint: 'different-fingerprint' };
    writeFileSync(path, JSON.stringify([mismatch]));

    assert.throws(() => journal.entries(), /Invalid remediation PR journal/);
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), [mismatch]);
  });

  it('rejects malformed PR journal fields instead of silently rewriting them', () => {
    const path = join(
      mkdtempSync(join(tmpdir(), 'baci-pr-journal-raw-validation-')),
      'journal.json'
    );
    const journal = createRemediationPrJournal({ path });

    assert.throws(
      () =>
        journal.record({
          candidate: {
            caseKey: 'sentry:sentry_issue:journal-raw',
            fingerprint: 'journal-raw',
            observationMarker: '2026-08-09T10:00:00.000Z',
          },
          result: {
            branch: 'codex/fix journal-raw',
            prUrl: 'https://github.com/baci/baci/pull/78',
          },
        }),
      /Invalid remediation PR journal entry/
    );
  });

  it('clears one recovery entry without removing the others', () => {
    const path = join(
      mkdtempSync(join(tmpdir(), 'baci-pr-journal-clear-')),
      'journal.json'
    );
    const journal = createRemediationPrJournal({ path });
    for (const fingerprint of ['journal-clear-1', 'journal-clear-2']) {
      journal.record({
        candidate: {
          caseKey: `sentry:sentry_issue:${fingerprint}`,
          fingerprint,
          observationMarker: '2026-08-09T10:00:00.000Z',
        },
        result: {
          branch: `codex/fix-${fingerprint}`,
          prUrl: 'https://github.com/baci/baci/pull/79',
        },
      });
    }

    journal.clear('sentry:sentry_issue:journal-clear-1');

    assert.deepEqual(
      journal.entries().map((entry) => entry.fingerprint),
      ['journal-clear-2']
    );
  });

  it('reads only the latest one hundred recovery entries', () => {
    const path = join(
      mkdtempSync(join(tmpdir(), 'baci-pr-journal-cap-')),
      'journal.json'
    );
    const entries = Array.from({ length: 150 }, (_, index) => {
      const fingerprint = `journal-${index}`;
      return {
        at: '2026-08-09T10:01:00.000Z',
        branch: `codex/fix-${fingerprint}`,
        caseKey: `sentry:sentry_issue:${fingerprint}`,
        fingerprint,
        observation: '2026-08-09T10:00:00.000Z',
        prUrl: 'https://github.com/baci/baci/pull/80',
        type: 'pr_opened',
      };
    });
    writeFileSync(path, JSON.stringify(entries));

    const journal = createRemediationPrJournal({ path });

    assert.equal(journal.entries().length, 100);
    assert.equal(journal.entries()[0].fingerprint, 'journal-50');
  });

  it('does not overwrite or clear journal recovery while another worker holds the update lock', () => {
    const path = join(
      mkdtempSync(join(tmpdir(), 'baci-pr-journal-lock-')),
      'journal.json'
    );
    const journal = createRemediationPrJournal({ path });
    const candidate = {
      caseKey: 'vercel:vercel_runtime_exception:journal-1',
      fingerprint: 'journal-1',
      observationMarker: '2026-08-09T10:00:00.000Z',
    };
    const result = {
      branch: 'codex/fix-journal-1',
      prUrl: 'https://github.com/baci/baci/pull/77',
    };
    journal.record({ candidate, result });
    writeFileSync(`${path}.lock`, 'another worker');

    assert.throws(
      () =>
        journal.record({
          candidate: {
            ...candidate,
            caseKey: 'vercel:vercel_runtime_exception:journal-2',
            fingerprint: 'journal-2',
          },
          result,
        }),
      /remediation PR journal is busy/
    );
    assert.throws(
      () => journal.clear(candidate.caseKey),
      /remediation PR journal is busy/
    );
    assert.equal(journal.entries().length, 1);
  });
});
