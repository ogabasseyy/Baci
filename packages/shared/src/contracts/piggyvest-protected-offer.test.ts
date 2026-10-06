import { expect, it } from 'vitest';
import { protectedOfferFixture } from '../lib/piggyvest-protected-offer.test-support';
import { piggyvestProtectedOfferSchemas as schemas } from './piggyvest-protected-offer';

const id = '30000000-0000-4000-8000-000000000001';
it('canonicalizes valid uppercase goal and offer IDs before the shared server scope boundary', () => {
  const canonical = 'abcdefab-0000-4000-8000-000000000001';
  expect(
    schemas.request.parse({
      goalId: canonical.toUpperCase(),
      offerId: canonical.toUpperCase(),
    })
  ).toEqual({ goalId: canonical, offerId: canonical });
});
it('projects only public observation fields and rejects private database authority', () => {
  const observation = protectedOfferFixture().observation;
  expect(schemas.observationRows.parse([{ result: observation }])).toEqual([
    { result: observation },
  ]);
  for (const extra of [
    { actorId: id },
    { balanceKobo: 100 },
    { source: {} },
    { authorizedLogin: 'writer' },
  ])
    expect(
      schemas.observation.safeParse({ ...observation, ...extra }).success
    ).toBe(false);
  expect(
    schemas.observation.safeParse({ ...observation, funds: 'spendable' })
      .success
  ).toBe(false);
});
it('accepts only goal and stable offer identity, never acceptance or price', () => {
  expect(schemas.request.parse({ goalId: id, offerId: id })).toEqual({
    goalId: id,
    offerId: id,
  });
  for (const extra of [{ priceKobo: 1 }, { accepted: true }, { actorId: id }])
    expect(
      schemas.request.safeParse({ goalId: id, offerId: id, ...extra }).success
    ).toBe(false);
});
it('requires exact seven-day publication, server scope and no private extras', () => {
  const receipt = {
    offerId: id,
    goalId: id,
    revisionId: id,
    device: { productId: id, variantId: null, condition: 'new' },
    priceKobo: 97000,
    termsVersion: 'synthetic',
    termsHash: 'a'.repeat(64),
    startsAt: '2026-09-12T12:00:00.000000Z',
    expiresAt: '2026-09-19T12:00:00.000000Z',
    scope: 'device_price_only',
    purchase: 'requires_confirmation',
    dispatch: 'disabled',
  };
  expect(schemas.receipt.safeParse(receipt).success).toBe(true);
  for (const patch of [
    { expiresAt: '2026-09-20T12:00:00Z' },
    { priceKobo: 0 },
    { priceKobo: 1.1 },
    { actorId: id },
    { dispatch: 'enabled' },
  ])
    expect(schemas.receipt.safeParse({ ...receipt, ...patch }).success).toBe(
      false
    );
});
