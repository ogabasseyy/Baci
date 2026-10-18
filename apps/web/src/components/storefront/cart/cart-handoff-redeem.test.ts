import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as csrf from '@/lib/csrf';
import {
  type HandoffRedeemDeps,
  postHandoffRedeem,
} from './cart-handoff-redeem';

beforeEach(() => {
  vi.spyOn(csrf, 'getClientCsrfToken').mockReturnValue('test-csrf-token');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function deps(overrides: Partial<HandoffRedeemDeps> = {}): HandoffRedeemDeps {
  return {
    handoffId: 'public-id',
    merchantSlug: 'shop',
    bootstrapRequired: { current: false },
    setRedeeming: vi.fn(),
    setRedeemError: vi.fn(),
    setConflicts: vi.fn(),
    setResolutions: vi.fn(),
    setLoadError: vi.fn(),
    onAttemptConsumed: vi.fn(),
    onTerminalOutcome: vi.fn(),
    onMergeConflict: vi.fn(),
    refreshPreview: vi.fn(async () => null),
    ...overrides,
  };
}

it('initializes CSRF via /api/csrf before bootstrap and redeem when no CSRF cookie exists', async () => {
  let currentCsrfToken: string | null = null;
  vi.spyOn(csrf, 'getClientCsrfToken').mockImplementation(
    () => currentCsrfToken
  );
  const fetchMock = vi.fn().mockImplementation(async (url: string) => {
    if (url === '/api/csrf') {
      currentCsrfToken = 'minted-csrf-token';
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (url === '/api/storefront/cart/bootstrap') {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response(JSON.stringify({ code: 'handoff_consumed' }), {
      status: 410,
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  const redeemDeps = deps({ bootstrapRequired: { current: true } });

  await expect(
    postHandoffRedeem(redeemDeps, { choice: 'connect' })
  ).resolves.toBe(false);

  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    '/api/csrf',
    '/api/storefront/cart/bootstrap',
    '/api/storefront/cart/handoff/redeem?merchantSlug=shop',
  ]);
  const bootstrapInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
  const redeemInit = fetchMock.mock.calls[2]?.[1] as RequestInit;
  expect(new Headers(bootstrapInit.headers).get('x-csrf-token')).toBe(
    'minted-csrf-token'
  );
  expect(bootstrapInit.referrerPolicy).toBe('no-referrer');
  expect(new Headers(redeemInit.headers).get('x-csrf-token')).toBe(
    'minted-csrf-token'
  );
  expect(redeemInit.referrerPolicy).toBe('no-referrer');
});

it('releases the attempt and refreshes previews after a version conflict', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 'version_conflict' }), {
        status: 409,
      })
    )
  );
  const redeemDeps = deps();
  await expect(postHandoffRedeem(redeemDeps, {})).resolves.toBe(false);
  expect(redeemDeps.onAttemptConsumed).toHaveBeenCalledTimes(1);
  expect(redeemDeps.refreshPreview).toHaveBeenCalledTimes(1);
  expect(redeemDeps.setConflicts).toHaveBeenCalledWith([]);
  expect(redeemDeps.setResolutions).toHaveBeenCalledWith({});
});

it('keeps the attempt after an indeterminate server failure', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 'temporarily_unavailable' }), {
        status: 503,
      })
    )
  );
  const redeemDeps = deps();
  await expect(postHandoffRedeem(redeemDeps, {})).resolves.toBe(false);
  expect(redeemDeps.onAttemptConsumed).not.toHaveBeenCalled();
  expect(redeemDeps.refreshPreview).not.toHaveBeenCalled();
});

it('releases the attempt and requires bootstrap after a proof rejection', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 'expired_proof' }), {
        status: 401,
      })
    )
  );
  const redeemDeps = deps();
  await expect(postHandoffRedeem(redeemDeps, {})).resolves.toBe(false);
  expect(redeemDeps.onAttemptConsumed).toHaveBeenCalledTimes(1);
  expect(redeemDeps.bootstrapRequired.current).toBe(true);
  expect(redeemDeps.refreshPreview).toHaveBeenCalledTimes(1);
});

it('consumes the attempt after a consumed-handoff reply', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 'handoff_consumed' }), {
        status: 410,
      })
    )
  );
  const redeemDeps = deps();
  await expect(postHandoffRedeem(redeemDeps, {})).resolves.toBe(false);
  expect(redeemDeps.onAttemptConsumed).toHaveBeenCalledTimes(1);
  expect(redeemDeps.onTerminalOutcome).toHaveBeenCalledTimes(1);
  expect(redeemDeps.setLoadError).toHaveBeenCalledWith(
    expect.stringMatching(/already used/)
  );
});
