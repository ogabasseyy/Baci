import { afterEach, expect, it, vi } from 'vitest';
import { purchaseJourneyFixture } from './purchase-journey-runtime.fixture';

vi.mock('server-only', () => ({}));
afterEach(() => vi.unstubAllEnvs());
it('refuses to stage or start browser fixtures without a validated local socket', async () => {
  vi.stubEnv('PIGGYVEST_LOCAL_TEST_SOCKET', 'remote.example');
  await expect(purchaseJourneyFixture()).rejects.toThrow();
});
