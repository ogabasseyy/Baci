import { describe, expect, it, vi } from 'vitest';
import { primaryCardTransferFixture as fixture } from './primary-wallet-card-transfer.test-fixture';
import { createPrimaryCardTransferLookup } from './primary-wallet-card-transfer-lookup';

function lookupWith(body: unknown, status = 200) {
  const fetchImplementation = vi.fn().mockResolvedValue(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
    })
  );
  const lookup = createPrimaryCardTransferLookup({
    configuration: fixture.configuration,
    fetchImplementation,
    now: () => fixture.now,
  });
  return { fetchImplementation, lookup };
}

const success = {
  status: true,
  data: {
    status: 'successful',
    id: 'provider-transaction',
    internal_reference: 'provider-transaction',
    reference: 'provider-reference',
    third_party_reference: fixture.command.reference,
    amount: fixture.command.amountKobo,
    fee: 0,
    customer_id: 'owner-treasury-customer',
    source_wallet: fixture.command.sourceWalletId,
    destination_wallet: fixture.command.destinationWalletId,
  },
};

describe('authoritative transfer reference lookup', () => {
  it('reports submitted only for provider evidence bound to the command', async () => {
    const { fetchImplementation, lookup } = lookupWith(success);
    expect(await lookup(fixture.command, fixture.context)).toBe('submitted');
    expect(fetchImplementation).toHaveBeenCalledWith(
      expect.stringContaining(
        `/api/v1/transaction/verify?reference=${encodeURIComponent(fixture.command.reference)}`
      ),
      expect.objectContaining({ method: 'GET' })
    );
  });
  it.each([
    { third_party_reference: 'another-reference' },
    { amount: fixture.command.amountKobo + 1 },
    { source_wallet: 'another-wallet' },
    { destination_wallet: 'another-wallet' },
  ])('reports uncertain for unbound success evidence: %j', async (change) => {
    const { lookup } = lookupWith({
      ...success,
      data: { ...success.data, ...change },
    });
    expect(await lookup(fixture.command, fixture.context)).toBe('uncertain');
  });
  it('reports uncertain for failed or malformed provider evidence', async () => {
    for (const body of [
      { ...success, data: { ...success.data, status: 'failed' } },
      { status: true, data: { status: 'successful' } },
      'not-json-at-all{{{',
    ]) {
      const { lookup } = lookupWith(body);
      expect(await lookup(fixture.command, fixture.context)).toBe('uncertain');
    }
  });
  it('reports absent only on an authoritative 404', async () => {
    const { lookup } = lookupWith({ status: false, message: 'not found' }, 404);
    expect(await lookup(fixture.command, fixture.context)).toBe('absent');
  });
  it.each([
    400, 429, 500,
  ])('reports uncertain on HTTP %i instead of proving absence', async (status) => {
    const { lookup } = lookupWith({ status: false }, status);
    expect(await lookup(fixture.command, fixture.context)).toBe('uncertain');
  });
  it('reports uncertain when the provider is unreachable', async () => {
    const fetchImplementation = vi
      .fn()
      .mockRejectedValue(new Error('connection lost'));
    const lookup = createPrimaryCardTransferLookup({
      configuration: fixture.configuration,
      fetchImplementation,
      now: () => fixture.now,
    });
    expect(await lookup(fixture.command, fixture.context)).toBe('uncertain');
  });
  it('refuses changed immutable command before HTTP', async () => {
    const { fetchImplementation, lookup } = lookupWith(success);
    await expect(
      lookup(
        {
          ...fixture.command,
          reference:
            'pvb-primary-transfer-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
        fixture.context
      )
    ).rejects.toThrow();
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
