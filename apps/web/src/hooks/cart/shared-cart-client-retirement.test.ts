import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fetchWithCsrf } from '@/lib/api-client';
import { beginCartSessionRetirement } from './cart-session-write-fence';
import {
  fetchSharedCartSnapshot,
  sendSharedCartCommand,
} from './shared-cart-client';
import { snapshot } from './shared-cart-provisioning.test-support';
import { resetPendingCartDeviceRevocationsForTests } from './shared-cart-session-revoke-client';

vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: vi.fn() }));
const fetchMock = vi.fn();
// The global setup installs a LockManager mock; these suites exercise
// the synchronous no-Web-Locks fallback path instead.
beforeEach(() => {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: undefined,
  });
});
beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => vi.unstubAllGlobals());
function jsonResponse(payload: unknown) {
  return Response.json(payload);
}
it.each([
  'command',
  'snapshot',
] as const)('drains in-flight %s requests before retirement completes', async (kind) => {
  resetPendingCartDeviceRevocationsForTests();
  vi.clearAllMocks();
  let finish!: (response: Response) => void;
  const reply = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  if (kind === 'command') vi.mocked(fetchWithCsrf).mockReturnValueOnce(reply);
  else fetchMock.mockReturnValueOnce(reply);
  const request =
    kind === 'command'
      ? sendSharedCartCommand(
          {
            command: { type: 'clear' },
            expectedVersion: 3,
            operationId: 'drain',
          },
          'shop'
        )
      : fetchSharedCartSnapshot(undefined, 'shop');
  const retirement = beginCartSessionRetirement('shop');
  const drained = vi.fn();
  void retirement.drained.then(drained);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(drained).not.toHaveBeenCalled();
  finish(jsonResponse({ cart: snapshot() }));
  await request;
  await retirement.drained;
  expect(drained).toHaveBeenCalledOnce();
  retirement.release();
});
