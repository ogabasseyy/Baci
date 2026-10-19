import { expect, it, vi } from 'vitest';
import { protectedOfferFixture } from './piggyvest-protected-offer.test-support';
import { createPiggyvestProtectedOfferController } from './piggyvest-protected-offer-controller';

function setup(mode: 'publish' | 'history' = 'publish') {
  const fixture = protectedOfferFixture();
  const client = {
    publish: vi.fn().mockResolvedValue(fixture.published),
    status: vi.fn().mockResolvedValue(fixture.observation),
  };
  const binding = createPiggyvestProtectedOfferController({
    source: fixture.source,
    tenantKey: 'synthetic',
    offerId: fixture.receipt.goalId,
    mode,
    client,
    isCurrent: () => true,
  });
  return { ...fixture, client, binding };
}
it('keeps deduplicated original offer ID and clock and refreshes status without republishing', async () => {
  const test = setup();
  await test.binding.load();
  expect(test.client.status).toHaveBeenCalledWith(
    { goalId: test.receipt.goalId, offerId: test.receipt.offerId },
    expect.any(AbortSignal)
  );
  await test.binding.load();
  expect(test.client.publish).toHaveBeenCalledOnce();
  expect(test.binding.read(test.source)?.receipt).toEqual(test.receipt);
});
it('uses only server-observed expiry and does not create checkout or acceptance authority', async () => {
  const test = setup();
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2099-01-01T00:00:00Z'));
  try {
    await test.binding.load();
    expect(test.binding.read(test.source)?.observation?.pricePromise).toBe(
      'active'
    );
    test.client.status.mockResolvedValue({
      ...test.observation,
      observedAt: test.receipt.expiresAt,
      pricePromise: 'expired',
    });
    await test.binding.load();
    expect(test.binding.read(test.source)?.observation?.pricePromise).toBe(
      'expired'
    );
    expect(test.client.publish).toHaveBeenCalledOnce();
  } finally {
    vi.restoreAllMocks();
  }
});
it('clears active evidence on failed read and cannot renew after lost publication response', async () => {
  const test = setup();
  test.client.publish.mockRejectedValue(new Error('lost'));
  await expect(test.binding.load()).rejects.toThrow();
  test.client.status.mockRejectedValue(new Error('unknown'));
  await expect(test.binding.load()).rejects.toThrow();
  expect(test.client.publish).toHaveBeenCalledOnce();
  expect(test.binding.read(test.source)).toMatchObject({
    status: 'unavailable',
    observation: null,
  });
});
it('recovers a lost deduplicated publication using its requested alias without renewing the original clock', async () => {
  const test = setup();
  test.client.publish.mockRejectedValue(
    new Error('lost after alias committed')
  );
  await expect(test.binding.load()).rejects.toThrow();
  test.client.status.mockResolvedValue({
    ...test.observation,
    requestedOfferId: test.receipt.goalId,
  });
  await test.binding.load();
  expect(test.binding.read(test.source)).toMatchObject({
    offerId: test.receipt.offerId,
    receipt: test.receipt,
  });
  test.client.status.mockResolvedValue(test.observation);
  await test.binding.load();
  expect(test.client.publish).toHaveBeenCalledOnce();
  expect(test.client.status).toHaveBeenLastCalledWith(
    { goalId: test.receipt.goalId, offerId: test.receipt.offerId },
    expect.any(AbortSignal)
  );
});
it('rejects stale revision and invalidates display on changed current source', async () => {
  const test = setup();
  test.client.publish.mockResolvedValue({
    ...test.published,
    receipt: { ...test.receipt, revisionId: test.receipt.goalId },
  });
  await expect(test.binding.load()).rejects.toThrow();
  expect(test.client.status).not.toHaveBeenCalled();
  expect(
    test.binding.read({
      ...test.source,
      policy: {
        ...test.source.policy,
        terms: { ...test.source.policy.terms, version: 'changed' },
      },
    })
  ).toBeNull();
  await expect(test.binding.load()).rejects.toThrow();
});
it('clears a previously active observation during and after failed refresh', async () => {
  const test = setup();
  await test.binding.load();
  test.client.status.mockRejectedValue(new Error('lost read'));
  const pending = test.binding.load();
  expect(test.binding.read(test.source)).toMatchObject({
    busy: true,
    observation: null,
  });
  await expect(pending).rejects.toThrow();
  expect(test.binding.read(test.source)).toMatchObject({
    busy: false,
    status: 'unavailable',
    observation: null,
    receipt: test.receipt,
  });
});
