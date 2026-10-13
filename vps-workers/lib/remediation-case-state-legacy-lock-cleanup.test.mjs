import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
import { createLegacyRemediationLockCleaner } from './remediation-case-state-legacy-lock-cleanup.mjs';

it('rescans exact legacy artifacts only when the primary lock reappears', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'baci-legacy-lock-cleanup-'));
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  const lockPath = join(directory, 'state.json.lock');
  const token = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const legacyPaths = [
    lockPath,
    `${lockPath}.owner-${token}`,
    `${lockPath}.reclaim-${token}`,
    `${lockPath}.reclaim-ownerless`,
  ];
  const unrelatedPath = `${lockPath}.owner-not-a-token`;
  for (const path of [...legacyPaths, unrelatedPath]) writeFileSync(path, 'x');
  let scans = 0;
  const cleaner = createLegacyRemediationLockCleaner(
    lockPath,
    unlinkSync,
    (path) => {
      scans += 1;
      return readdirSync(path);
    }
  );

  cleaner();
  cleaner();

  assert.equal(legacyPaths.some(existsSync), false);
  assert.equal(existsSync(unrelatedPath), true);
  assert.equal(scans, 1);

  writeFileSync(lockPath, 'legacy lock');
  writeFileSync(`${lockPath}.owner-${token}`, 'legacy owner');

  cleaner();

  assert.equal(existsSync(lockPath), false);
  assert.equal(existsSync(`${lockPath}.owner-${token}`), false);
  assert.equal(scans, 2);
});
