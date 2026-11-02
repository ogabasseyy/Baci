// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ open: vi.fn(), server: vi.fn() }));
vi.mock('./inbox', () => ({ openStagingInbox: mocks.open }));
vi.mock('./server', () => ({ createStagingWebhookServer: mocks.server }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it('rejects missing or mismatched callback credentials before opening the inbox or server', async () => {
  const validBinding = createHash('sha256').update('partner').digest('hex');
  for (const [reference, key, secret, binding] of [
    ['', 'key', 'secret', validBinding],
    ['partner', '', 'secret', validBinding],
    ['partner', 'key', '', validBinding],
    ['partner', 'key', 'secret', 'mismatch'],
  ]) {
    vi.resetModules();
    vi.stubEnv('OXYGEN_TEST_REFERENCE', reference);
    vi.stubEnv('OXYGEN_CALLBACK_KEY', key);
    vi.stubEnv('OXYGEN_CALLBACK_SECRET', secret);
    vi.stubEnv('OXYGEN_CALLBACK_BINDING', binding);
    await expect(import('./cli')).rejects.toThrow(
      'Staging callback configuration unavailable'
    );
  }
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.server).not.toHaveBeenCalled();
});
