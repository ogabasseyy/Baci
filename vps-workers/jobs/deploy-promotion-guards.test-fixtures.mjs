import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const workerRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
export const releaseHelper = join(
  workerRoot,
  'lib',
  'prepare-worker-release.sh'
);
export const quiesceHelper = join(
  workerRoot,
  'lib',
  'quiesce-worker-release.sh'
);

export function readPromotionSource() {
  const source = readFileSync(releaseHelper, 'utf8');
  const promotionStart = source.indexOf(
    'flock -x /tmp/baci-workers-deploy.lock'
  );
  const promotionEnd = source.indexOf('REMOTE_SH\n\n', promotionStart);

  assert.notEqual(promotionStart, -1);
  return {
    promotionSource: source.slice(promotionStart, promotionEnd),
    source,
  };
}
