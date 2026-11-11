/**
 * Test files (relative to apps/web) inside the folders of vitest.node-folders.ts
 * that need a DOM but must not be edited to say so. They run in the
 * `jsdom-holdouts` Vitest project: the same jsdom environment and setup as the
 * `jsdom` project, selected by this list instead of a docblock.
 *
 * Use it only for files that a digest or provenance gate binds. Today that is
 * tests under directories that docs/product/agent-access-map.md cites as
 * capability evidence: any edit to those paths forces a capability-register
 * re-review (vps-workers/baci-editorial-context/capability_gate.py), and
 * re-dating that review for a comment-only change would misstate how fresh the
 * reviewed claims are. Every other test that needs a DOM should simply carry a
 * `// @vitest-environment jsdom` docblock.
 */
export const JSDOM_HOLDOUT_FILES: readonly string[] = [
  'src/app/dashboard/channels/jumia-discovery-resume-storage.test.ts',
  'src/app/dashboard/channels/use-jumia-channel-actions.test.ts',
  'src/app/dashboard/channels/use-jumia-integrations.test.ts',
  'src/app/dashboard/orders/[orderId]/use-order-refund-submit.test.ts',
  'src/app/dashboard/orders/[orderId]/use-refund-pin-amount-cap.test.ts',
  'src/app/dashboard/orders/[orderId]/use-refund-status-polling.test.ts',
  'src/app/dashboard/settings/payments/components/use-virtual-terminal-settings.test.ts',
  'src/app/dashboard/settings/payments/use-payment-bank-completion.test.ts',
];
