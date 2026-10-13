import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { canonicalJson } from './canonical-json.mjs';
import { readTask9PrMetadata } from './task9-pr-metadata.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('reads canonical preserved PR metadata bound by its bare digest', () => {
  const root = mkdtempSync(join(tmpdir(), 'task9-pr-metadata-'));
  try {
    chmodSync(root, 0o700);
    const value = {
      baseSha: 'a'.repeat(40),
      headRef: 'codex/task9',
      mergeSha: 'c'.repeat(40),
      number: 3302,
      reviewedHeadSha: 'b'.repeat(40),
      workflowId: 42,
    };
    const bytes = Buffer.from(canonicalJson(value));
    const path = join(root, 'metadata.json');
    const digest = join(root, 'metadata.sha256');
    writeFileSync(path, bytes, { mode: 0o600 });
    writeFileSync(digest, `${hash(bytes)}\n`, { mode: 0o600 });
    assert.deepEqual(
      readTask9PrMetadata(path, digest, {
        reviewedSha256: hash(bytes),
        verify: (endpoint) =>
          endpoint.includes('/pulls/')
            ? {
                base: {
                  ref: 'main',
                  repo: { full_name: 'ogabasseyy/Baci' },
                  sha: value.baseSha,
                },
                head: { ref: value.headRef, sha: value.reviewedHeadSha },
                merge_commit_sha: value.mergeSha,
                merged: true,
                merged_at: '2026-08-12T00:00:00Z',
                number: value.number,
                state: 'closed',
              }
            : {
                id: value.workflowId,
                path: '.github/workflows/cwv-runner-attestation.yml',
              },
      }),
      value
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('rejects a noncanonical, mismatched, or no-op preserved PR record', () => {
  const root = mkdtempSync(join(tmpdir(), 'task9-pr-metadata-invalid-'));
  try {
    chmodSync(root, 0o700);
    const path = join(root, 'metadata.json');
    const digest = join(root, 'metadata.sha256');
    const value = {
      baseSha: 'a'.repeat(40),
      headRef: 'codex/task9',
      mergeSha: 'c'.repeat(40),
      number: 3302,
      reviewedHeadSha: 'b'.repeat(40),
      workflowId: 42,
    };
    const bytes = Buffer.from(canonicalJson(value));
    writeFileSync(path, bytes, { mode: 0o600 });
    writeFileSync(digest, `${'0'.repeat(64)}\n`, { mode: 0o600 });
    assert.throws(
      () => readTask9PrMetadata(path, digest, { reviewedSha256: hash(bytes) }),
      /preserved PR metadata/
    );
    writeFileSync(digest, `${hash(bytes)}\n`);
    writeFileSync(path, Buffer.from(JSON.stringify(value, null, 2)));
    writeFileSync(digest, `${hash(readFileSync(path))}\n`);
    assert.throws(
      () => readTask9PrMetadata(path, digest),
      /preserved PR metadata/
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('rejects a forged matching metadata and digest pair against the review literal', () => {
  const root = mkdtempSync(join(tmpdir(), 'task9-pr-metadata-anchor-'));
  try {
    chmodSync(root, 0o700);
    const original = Buffer.from(
      canonicalJson({
        baseSha: 'a'.repeat(40),
        headRef: 'codex/task9',
        mergeSha: 'c'.repeat(40),
        number: 3302,
        reviewedHeadSha: 'b'.repeat(40),
        workflowId: 42,
      })
    );
    const forged = Buffer.from(
      canonicalJson({
        baseSha: 'a'.repeat(40),
        headRef: 'attacker/ref',
        mergeSha: 'c'.repeat(40),
        number: 3302,
        reviewedHeadSha: 'b'.repeat(40),
        workflowId: 42,
      })
    );
    const path = join(root, 'metadata.json');
    const digest = join(root, 'metadata.sha256');
    writeFileSync(path, forged, { mode: 0o600 });
    writeFileSync(digest, `${hash(forged)}\n`, { mode: 0o600 });
    assert.throws(
      () =>
        readTask9PrMetadata(path, digest, { reviewedSha256: hash(original) }),
      /preserved PR metadata/
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('rejects matching local metadata when GitHub reports another PR head', () => {
  const root = mkdtempSync(join(tmpdir(), 'task9-pr-metadata-github-'));
  try {
    chmodSync(root, 0o700);
    const value = {
      baseSha: 'a'.repeat(40),
      headRef: 'codex/task9',
      mergeSha: 'c'.repeat(40),
      number: 3302,
      reviewedHeadSha: 'b'.repeat(40),
      workflowId: 42,
    };
    const bytes = Buffer.from(canonicalJson(value));
    const path = join(root, 'metadata.json');
    const digest = join(root, 'metadata.sha256');
    writeFileSync(path, bytes, { mode: 0o600 });
    writeFileSync(digest, `${hash(bytes)}\n`, { mode: 0o600 });
    assert.throws(
      () =>
        readTask9PrMetadata(path, digest, {
          reviewedSha256: hash(bytes),
          verify: (endpoint) =>
            endpoint.includes('/pulls/')
              ? {
                  base: { sha: value.baseSha },
                  head: { ref: 'forged/ref', sha: value.reviewedHeadSha },
                  number: value.number,
                }
              : {
                  id: 42,
                  path: '.github/workflows/cwv-runner-attestation.yml',
                },
        }),
      /preserved PR metadata/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects Git-invalid preserved head refs', () => {
  const root = mkdtempSync(join(tmpdir(), 'task9-pr-metadata-ref-'));
  try {
    chmodSync(root, 0o700);
    for (const headRef of [
      'release//candidate',
      'release/.hidden',
      'release.lock',
      'release/',
      'release..',
    ]) {
      const value = {
        baseSha: 'a'.repeat(40),
        headRef,
        mergeSha: 'c'.repeat(40),
        number: 3302,
        reviewedHeadSha: 'b'.repeat(40),
      };
      const bytes = Buffer.from(canonicalJson(value));
      const path = join(root, 'metadata.json');
      const digest = join(root, 'metadata.sha256');
      writeFileSync(path, bytes, { mode: 0o600 });
      writeFileSync(digest, `${hash(bytes)}\n`, { mode: 0o600 });
      assert.throws(
        () =>
          readTask9PrMetadata(path, digest, { reviewedSha256: hash(bytes) }),
        /preserved PR metadata/
      );
    }
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
