import { beforeEach, expect, it, vi } from 'vitest';
import { AttemptAdmissionDenied } from '@/lib/api-attempt-policy';
import { fetchWithCsrf } from '@/lib/api-client';
import { sendSharedCartCommand } from './shared-cart-client';

vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: vi.fn() }));

const snapshot = {
  cartId: 'cart',
  merchantId: 'merchant',
  version: 1,
  lines: [],
};

beforeEach(() => {
  vi.mocked(fetchWithCsrf).mockReset();
});

it('keeps experience admission inside the bounded cart-session transport', async () => {
  const beforeAttempt = vi.fn(() => ({
    allowed: false as const,
    code: 'STALE_ROUTE',
  }));
  const onAttemptStart = vi.fn();
  vi.mocked(fetchWithCsrf).mockImplementation(async (_url, _init, policy) => {
    const admission = policy?.beforeAttempt();
    if (admission && !admission.allowed)
      throw new AttemptAdmissionDenied(admission.code, false, 'none');
    return new Response(
      JSON.stringify({
        cart: {
          cartId: 'cart',
          merchantId: 'merchant',
          version: 1,
          lines: [],
        },
      }),
      { status: 200 }
    );
  });
  await expect(
    sendSharedCartCommand(
      {
        command: { type: 'clear' },
        expectedVersion: 1,
        operationId: 'synthetic-fence',
      },
      'qa1',
      { beforeAttempt, onAttemptStart }
    )
  ).resolves.toMatchObject({
    ok: false,
    admissionDenied: true,
    denialCode: 'STALE_ROUTE',
    attempted: false,
  });
  expect(beforeAttempt).toHaveBeenCalledOnce();
  expect(onAttemptStart).not.toHaveBeenCalled();
  expect(fetchWithCsrf).toHaveBeenCalledWith(
    expect.stringContaining('/api/storefront/cart/commands'),
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
    expect.objectContaining({ beforeAttempt, onAttemptStart })
  );
});

it('returns the admitted snapshot and forwards the attempt policy unchanged', async () => {
  const policy = {
    beforeAttempt: vi.fn(() => ({ allowed: true as const })),
    onAttemptStart: vi.fn(),
  };
  vi.mocked(fetchWithCsrf).mockResolvedValue(
    new Response(JSON.stringify({ cart: snapshot }), { status: 200 })
  );

  await expect(
    sendSharedCartCommand(
      {
        command: { type: 'clear' },
        expectedVersion: 1,
        operationId: 'synthetic-allowed-fence',
      },
      'qa1',
      policy
    )
  ).resolves.toMatchObject({ ok: true, snapshot });

  const call = vi.mocked(fetchWithCsrf).mock.calls[0];
  expect(call?.[2]).toBe(policy);
  expect(vi.mocked(fetchWithCsrf)).toHaveBeenCalledOnce();
});

it('calls fetchWithCsrf with exactly two arguments when no policy is supplied', async () => {
  vi.mocked(fetchWithCsrf).mockResolvedValue(
    new Response(JSON.stringify({ cart: snapshot }), { status: 200 })
  );

  await expect(
    sendSharedCartCommand(
      {
        command: { type: 'clear' },
        expectedVersion: 1,
        operationId: 'synthetic-no-policy',
      },
      'qa1'
    )
  ).resolves.toMatchObject({ ok: true, snapshot });

  expect(vi.mocked(fetchWithCsrf)).toHaveBeenCalledOnce();
  expect(vi.mocked(fetchWithCsrf).mock.calls[0]).toHaveLength(2);
});
