import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));

for (const [wrapper, label, script] of [
  [
    'process-gigl-tracking.sh',
    'gigl-tracking',
    'src/scripts/process-gigl-tracking.ts',
  ],
  [
    'verify-gigl-tracking-worker-capability.sh',
    'gigl-capability',
    'src/scripts/verify-gigl-tracking-worker-capability.ts',
  ],
  [
    'process-petrock-reconciliation.sh',
    'petrock-reconciliation',
    'src/scripts/process-petrock-reconciliation.ts',
  ],
  [
    'process-quiz-finalization.sh',
    'quiz-finalization',
    'src/scripts/process-quiz-finalization.ts',
  ],
  [
    'process-order-cancellation-side-effects.sh',
    'order-cancellation-side-effects',
    'src/scripts/process-order-cancellation-side-effects.ts',
  ],
  [
    'reconcile-vtu-processing.sh',
    'reconcile-vtu-processing',
    'src/scripts/reconcile-vtu-processing.ts',
  ],
  [
    'oxygen-callback-reconciliation.sh',
    'oxygen-callback-reconciliation',
    'src/scripts/oxygen-callback-reconciliation.ts',
  ],
  [
    'merchant-signup-health.sh',
    'merchant-signup-health',
    'src/scripts/merchant-signup-health.ts',
  ],
  [
    'cart-notice-health.sh',
    'cart-notice-health',
    'src/scripts/cart-notice-health.ts',
  ],
  [
    'process-order-notifications.sh',
    'order-notifications',
    'src/scripts/process-order-notifications.ts',
  ],
  [
    'publish-scheduled-posts.sh',
    'publish-scheduled-posts',
    'src/scripts/publish-scheduled-posts.ts',
  ],
  [
    'agentic-commerce-health.sh',
    'agentic-commerce-health',
    'src/scripts/agentic-commerce-health.ts',
  ],
  [
    'purge-jumia-self-authorization-discoveries.sh',
    'purge-jumia-self-authorization-discoveries',
    'src/scripts/purge-jumia-self-authorization-discoveries.ts',
  ],
  [
    'cleanup-checkout-shipping-recovery-previews.sh',
    'cleanup-checkout-shipping-recovery-previews',
    'src/scripts/cleanup-checkout-shipping-recovery-previews.ts',
  ],
]) {
  test(`${wrapper} delegates directly to its web script`, () => {
    const source = readFileSync(join(directory, wrapper), 'utf8');

    assert.match(source, /set -euo pipefail/);
    assert.match(
      source,
      /SCRIPT_DIR="\$\(CDPATH= cd -- "\$\(dirname -- "\$\{BASH_SOURCE\[0\]\}"\)" && pwd\)"/
    );
    assert.match(source, new RegExp(`run-web-script\\.sh" ${label} ${script}`));
    assert.doesNotMatch(source, /CRON_SECRET|run-web-cron|https?:\/\//);
    if (wrapper === 'process-quiz-finalization.sh') {
      assert.match(source, /--once/);
      assert.match(source, /--loop/);
      assert.match(source, /src\/scripts\/process-quiz-finalization\.ts "\$@"/);
    }
  });
}
