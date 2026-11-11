import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { findSilentReverts, parseRawDiff } from './detect-silent-reverts.mjs';

const zero = '0000000000000000000000000000000000000000';
const oldBlob = '1111111111111111111111111111111111111111';
const newBlob = '2222222222222222222222222222222222222222';
const otherBlob = '3333333333333333333333333333333333333333';

describe('parseRawDiff', () => {
  it('splits renames into delete and add entries', () => {
    const entries = parseRawDiff(
      `:100644 100644 ${oldBlob} ${newBlob} R100\told.ts\tnew.ts\n`
    );

    assert.deepEqual(entries, [
      { kind: 'D', newBlob: zero, oldBlob, path: 'old.ts' },
      { kind: 'A', newBlob, oldBlob: zero, path: 'new.ts' },
    ]);
  });
});

describe('findSilentReverts', () => {
  it('flags a pull request that restores a recent commit to its previous blob', () => {
    const findings = findSilentReverts({
      pullRequestEntries: [
        { kind: 'M', newBlob: oldBlob, oldBlob: newBlob, path: 'src/file.ts' },
      ],
      recentCommits: [
        {
          entries: [{ kind: 'M', newBlob, oldBlob, path: 'src/file.ts' }],
          sha: 'abcdef1234567890',
          subject: 'feat: important change (#100)',
        },
      ],
    });

    assert.deepEqual(findings, [
      {
        commit: 'abcdef1234567890',
        commitSubject: 'feat: important change (#100)',
        kind: 'restores previous blob',
        path: 'src/file.ts',
      },
    ]);
  });

  it('flags deletion of a recently added file', () => {
    const findings = findSilentReverts({
      pullRequestEntries: [
        { kind: 'D', newBlob: zero, oldBlob: newBlob, path: 'src/new-file.ts' },
      ],
      recentCommits: [
        {
          entries: [
            { kind: 'A', newBlob, oldBlob: zero, path: 'src/new-file.ts' },
          ],
          sha: 'abcdef1234567890',
          subject: 'feat: add file (#101)',
        },
      ],
    });

    assert.equal(findings.length, 1);
    assert.equal(findings[0].kind, 'deletes recently added file');
  });

  it('does not flag unrelated edits', () => {
    const findings = findSilentReverts({
      pullRequestEntries: [
        {
          kind: 'M',
          newBlob: otherBlob,
          oldBlob: newBlob,
          path: 'src/file.ts',
        },
      ],
      recentCommits: [
        {
          entries: [{ kind: 'M', newBlob, oldBlob, path: 'src/file.ts' }],
          sha: 'abcdef1234567890',
          subject: 'feat: important change (#100)',
        },
      ],
    });

    assert.deepEqual(findings, []);
  });
});

it('uses the full checkout for the private-repository revert guard', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/ci.yml', import.meta.url),
    'utf8'
  );
  const guard =
    workflow
      .split('    name: Silent Revert Guard')[1]
      ?.split('\n  quality:')[0] ?? '';
  assert.match(guard, /fetch-depth: 0/);
  assert.match(guard, /persist-credentials: false/);
  assert.match(guard, /BASE_SHA:.*pull_request.base.sha/);
  assert.doesNotMatch(guard, /git fetch/);
});
