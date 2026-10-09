import { describe, expect, it, vi } from 'vitest';
import { primaryCardCustodyFixture as fixture } from './primary-wallet-card-custody.test-fixture';
import { createPrimaryCardCustodyReader } from './primary-wallet-card-custody-reader';

function setup(configuration: unknown = fixture.configuration) {
  const fetchImplementation = vi.fn<typeof fetch>();
  for (const body of [
    fixture.single,
    fixture.verification,
    fixture.sourceWallet,
    fixture.destinationWallet,
  ])
    fetchImplementation.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status: 200 })
    );
  const resolveAuthenticatedCrosswalk = vi
    .fn()
    .mockResolvedValue(fixture.crosswalk);
  const read = createPrimaryCardCustodyReader({
    configuration,
    fetchImplementation,
    resolveAuthenticatedCrosswalk,
    now: () => fixture.now,
  });
  return { read, fetchImplementation, resolveAuthenticatedCrosswalk };
}
describe('primary custody bounded read-only observations', () => {
  it('reuses bounded existing HTTP mechanics and only documented GET paths', async () => {
    const input = setup();
    const observed = await input.read(fixture.context, fixture.envelope);
    expect(observed.crosswalk).toEqual(fixture.crosswalk);
    expect(input.fetchImplementation).toHaveBeenCalledTimes(4);
    const paths = input.fetchImplementation.mock.calls.map(([url, init]) => {
      expect(init).toEqual(
        expect.objectContaining({
          method: 'GET',
          redirect: 'error',
          signal: expect.any(AbortSignal),
        })
      );
      return String(url);
    });
    expect(paths).toEqual([
      'https://staging.piggyvest.business/api/v1/transaction/canonical-transfer?wallet_id=owner-treasury',
      `https://staging.piggyvest.business/api/v1/transaction/verify?reference=${fixture.context.reference}&wallet_id=owner-treasury`,
      'https://staging.piggyvest.business/api/v1/wallet/owner-treasury',
      'https://staging.piggyvest.business/api/v1/wallet/fixture-primary',
    ]);
    expect(input.resolveAuthenticatedCrosswalk).toHaveBeenCalledWith(
      fixture.context,
      fixture.single
    );
  });
  it.each([
    { ...fixture.configuration, integrationId: fixture.context.customerId },
    { ...fixture.configuration, environment: 'production' },
  ])('fails closed before observations for unavailable deployment scope %#', async (configuration) => {
    const input = setup(configuration);
    await expect(input.read(fixture.context, fixture.envelope)).rejects.toThrow(
      'Custody observation unavailable'
    );
    expect(input.fetchImplementation).not.toHaveBeenCalled();
  });
  it('keeps live observations available past the evidence window so the worker can drain', async () => {
    const input = setup({
      ...fixture.configuration,
      expiresAt: '2026-10-07T19:59:00Z',
    });
    const observed = await input.read(fixture.context, fixture.envelope);
    expect(observed.crosswalk).toEqual(fixture.crosswalk);
    expect(input.fetchImplementation).toHaveBeenCalledTimes(4);
  });
  it('does not invent an endpoint when crosswalk delivery is missing', async () => {
    const input = setup();
    input.resolveAuthenticatedCrosswalk.mockRejectedValue(
      new Error('not provided')
    );
    await expect(input.read(fixture.context, fixture.envelope)).rejects.toThrow(
      'not provided'
    );
    expect(input.fetchImplementation).toHaveBeenCalledTimes(4);
  });
  it.each([
    { contractId: 'unapproved' },
    { evidenceIssuer: 'unapproved' },
    { treasuryWebhookCustomerId: 'unapproved' },
    { transactionCustomerId: 'unapproved' },
  ])('does not authorize a crosswalk from an unconfigured authority %#', async (change) => {
    const input = setup();
    input.resolveAuthenticatedCrosswalk.mockResolvedValue({
      ...fixture.crosswalk,
      ...change,
    });
    expect(
      (await input.read(fixture.context, fixture.envelope)).crosswalk
    ).toBeNull();
  });
});
