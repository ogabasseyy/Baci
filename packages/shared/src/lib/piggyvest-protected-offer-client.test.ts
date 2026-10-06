import { expect, it, vi } from 'vitest';
import { protectedOfferFixture } from './piggyvest-protected-offer.test-support';
import { createPiggyvestProtectedOfferClient } from './piggyvest-protected-offer-client';

it('uses bounded signed-CSRF publish and exact scoped GET status with no acceptance field', async () => {
  const fixture = protectedOfferFixture();
  const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
    const result = Response.json(
      String(url).includes('/publish') ? fixture.published : fixture.observation
    );
    Object.defineProperty(result, 'url', { value: String(url) });
    return result;
  });
  const client = createPiggyvestProtectedOfferClient({
    configuration: {
      mode: 'local_test',
      baseUrl: 'http://127.0.0.1:3000',
      endpointPath: '/protected-offer',
    },
    goalId: fixture.receipt.goalId,
    fetch,
    getCsrfToken: async () => 'synthetic',
    isCurrent: () => true,
  });
  const input = {
    goalId: fixture.receipt.goalId,
    offerId: fixture.receipt.offerId,
  };
  await expect(client.publish({ ...input, accepted: true })).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
  expect(await client.publish(input)).toEqual(fixture.published);
  expect(await client.status(input)).toEqual(fixture.observation);
  expect(fetch).toHaveBeenLastCalledWith(
    `http://127.0.0.1:3000/protected-offer/status?goalId=${input.goalId}&offerId=${input.offerId}`,
    expect.objectContaining({
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
    })
  );
});
it('accepts exact requested alias while retaining original canonical receipt identity', async () => {
  const fixture = protectedOfferFixture();
  const input = {
    goalId: fixture.receipt.goalId,
    offerId: fixture.receipt.goalId,
  };
  const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
    const result = Response.json({
      ...fixture.observation,
      requestedOfferId: input.offerId,
    });
    Object.defineProperty(result, 'url', { value: String(url) });
    return result;
  });
  const client = createPiggyvestProtectedOfferClient({
    configuration: {
      mode: 'local_test',
      baseUrl: 'http://127.0.0.1:3000',
      endpointPath: '/protected-offer',
    },
    goalId: input.goalId,
    fetch,
    getCsrfToken: async () => 'synthetic',
    isCurrent: () => true,
  });
  expect((await client.status(input)).receipt.offerId).toBe(
    fixture.receipt.offerId
  );
});
