import { describe, expect, it, vi } from 'vitest';
import { createPrimaryWalletStore } from './primary-wallet-store';

vi.mock('server-only', () => ({}));

const scope = {
  merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  customerId: 'e648eb14-928a-427b-9719-b105f6d4b8b4',
  userId: 'f4f01e61-691f-494a-a895-872f17f8e55e',
  integrationId: 'd91d9e87-8e0d-44de-9b84-1e1d709633d2',
  businessId: 'test-business',
  environment: 'production' as const,
};
const intentId = '00000000-0000-4000-8000-000000000001';
const claimToken = '00000000-0000-4000-8000-000000000002';

describe('primary wallet storage boundary', () => {
  it('rejects substituted authenticated ownership without querying', async () => {
    const execute = vi.fn();
    const store = createPrimaryWalletStore({ scope, execute });
    await expect(
      store.claim({
        ...scope,
        userId: intentId,
        requestFingerprint: 'a'.repeat(64),
      })
    ).rejects.toThrow('Primary wallet storage unavailable');
    expect(execute).not.toHaveBeenCalled();
  });

  it('uses a parameterized atomic claim and parses its durable result', async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [{ result: { status: 'claimed', intentId, claimToken } }],
    });
    const store = createPrimaryWalletStore({ scope, execute });
    await expect(
      store.claim({ ...scope, requestFingerprint: 'a'.repeat(64) })
    ).resolves.toEqual({ status: 'claimed', intentId, claimToken });
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('piggyvest_primary.claim_onboarding'),
      [JSON.stringify(scope), 'a'.repeat(64)]
    );
  });

  it('rejects malformed database claims rather than contacting the provider', async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [{ result: { status: 'claimed', intentId } }],
    });
    await expect(
      createPrimaryWalletStore({ scope, execute }).claim({
        ...scope,
        requestFingerprint: 'a'.repeat(64),
      })
    ).rejects.toThrow('Primary wallet storage unavailable');
  });

  it('requires database confirmation that accepted identifiers were stored', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ result: false }] });
    await expect(
      createPrimaryWalletStore({ scope, execute }).recordAccepted({
        ...scope,
        intentId,
        claimToken,
        providerCustomerId: 'provider-customer',
        providerWalletId: 'provider-wallet',
      })
    ).resolves.toBe(false);
  });

  it('fails safely when an uncertain state cannot be durably recorded', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ result: false }] });
    await expect(
      createPrimaryWalletStore({ scope, execute }).recordUncertain({
        ...scope,
        intentId,
        claimToken,
      })
    ).rejects.toThrow('Primary wallet storage unavailable');
  });

  it('records explicit ownership rejections through the terminal rejection statement', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ result: true }] });
    await createPrimaryWalletStore({ scope, execute }).recordRejected({
      ...scope,
      intentId,
      claimToken,
    });
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('piggyvest_primary.record_onboarding_rejection'),
      [JSON.stringify(scope), intentId, claimToken]
    );
  });

  it('releases definitively rejected intents through the release statement', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ result: true }] });
    const released = await createPrimaryWalletStore({
      scope,
      execute,
    }).releaseIntent({ ...scope, intentId, claimToken });
    expect(released).toBe(true);
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('piggyvest_primary.release_onboarding_intent'),
      [JSON.stringify(scope), intentId, claimToken]
    );
  });

  it('never exposes database diagnostic text', async () => {
    const execute = vi
      .fn()
      .mockRejectedValue(new Error('secret connection detail'));
    await expect(
      createPrimaryWalletStore({ scope, execute }).claim({
        ...scope,
        requestFingerprint: 'a'.repeat(64),
      })
    ).rejects.toThrow('Primary wallet storage unavailable');
  });

  it('keeps routing-pending identifiers through the dedicated parameterized RPC', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ result: true }] });
    await expect(
      createPrimaryWalletStore({ scope, execute }).recordRoutingPending({
        ...scope,
        intentId,
        claimToken,
        providerCustomerId: 'provider-customer',
        providerWalletId: 'provider-wallet',
        interestPayoutWalletId: '01JBZ8Q5W3X9R2K4M6N8P0T2V4',
      })
    ).resolves.toBe(true);
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining(
        'piggyvest_primary.record_onboarding_routing_pending'
      ),
      [
        JSON.stringify(scope),
        intentId,
        claimToken,
        'provider-customer',
        'provider-wallet',
        '01JBZ8Q5W3X9R2K4M6N8P0T2V4',
      ]
    );
  });

  it.each([
    ['an empty provider customer', { providerCustomerId: '' }],
    ['a malformed payout wallet', { interestPayoutWalletId: 'payout' }],
  ])('refuses routing-pending identifiers with %s without querying', async (_label, change) => {
    const execute = vi.fn();
    await expect(
      createPrimaryWalletStore({ scope, execute }).recordRoutingPending({
        ...scope,
        intentId,
        claimToken,
        providerCustomerId: 'provider-customer',
        providerWalletId: 'provider-wallet',
        interestPayoutWalletId: '01JBZ8Q5W3X9R2K4M6N8P0T2V4',
        ...change,
      })
    ).rejects.toThrow('Primary wallet storage unavailable');
    expect(execute).not.toHaveBeenCalled();
  });

  it('resolves a routing-pending wallet through the fenced RPC with only its kept ids', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ result: true }] });
    await expect(
      createPrimaryWalletStore({ scope, execute }).resolveRoutingPending({
        ...scope,
        providerCustomerId: 'provider-customer',
        providerWalletId: 'provider-wallet',
        routed: false,
      })
    ).resolves.toBe(true);
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('piggyvest_primary.resolve_onboarding_routing'),
      [
        JSON.stringify(scope),
        JSON.stringify({
          providerCustomerId: 'provider-customer',
          providerWalletId: 'provider-wallet',
        }),
        'false',
      ]
    );
  });

  it.each([
    ['another user', { userId: intentId }],
    ['an empty provider wallet', { providerWalletId: '' }],
    ['a non-boolean verdict', { routed: 'false' }],
    ['a claim token', { claimToken }],
  ])('refuses a routing resolution with %s without querying', async (_label, change) => {
    const execute = vi.fn();
    await expect(
      createPrimaryWalletStore({ scope, execute }).resolveRoutingPending({
        ...scope,
        providerCustomerId: 'provider-customer',
        providerWalletId: 'provider-wallet',
        routed: true,
        ...change,
      } as Parameters<
        ReturnType<typeof createPrimaryWalletStore>['resolveRoutingPending']
      >[0])
    ).rejects.toThrow('Primary wallet storage unavailable');
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ['the query fails', () => Promise.reject(new Error('private detail'))],
    ['the result is malformed', async () => ({ rows: [{ result: 'yes' }] })],
  ])('reports a routing resolution as unavailable, without detail, when %s', async (_label, answer) => {
    const execute = vi.fn().mockImplementation(answer);
    await expect(
      createPrimaryWalletStore({ scope, execute }).resolveRoutingPending({
        ...scope,
        providerCustomerId: 'provider-customer',
        providerWalletId: 'provider-wallet',
        routed: true,
      })
    ).rejects.toThrow(/^Primary wallet storage unavailable$/);
  });
});
