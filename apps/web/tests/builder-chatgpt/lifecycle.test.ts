// @vitest-environment node
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createLifecycleHarness } from './lifecycle.test-utils';

let h: Awaited<ReturnType<typeof createLifecycleHarness>>;
beforeEach(async () => {
  h = await createLifecycleHarness();
}, 30000);
afterEach(async () => {
  await h?.close();
});
for (const existing of [false, true])
  it(`${existing ? 'existing live' : 'new private'} merchant keeps public content unchanged until exact owner approval`, async () => {
    const result = await h.journey(existing);
    expect(result.prepublicationUnchanged).toBe(true);
    expect(result.queued).toBe('pending');
    expect(result.ready).toBe('ready');
    expect(result.confirmed).toBe('verifying');
    expect(result.privateTitle).toBe('Approved lifecycle title');
    expect(result.publishedTitle).toBe('Approved lifecycle title');
    expect(result.receiptCount).toBe(1);
  });
