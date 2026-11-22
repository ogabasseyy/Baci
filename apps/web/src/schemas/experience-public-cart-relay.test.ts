import { expect, it } from 'vitest';
import { createPublicCartRelaySchemas } from './experience-public-cart-relay';

const productId = '11111111-1111-4111-8111-111111111111';
const variantId = '22222222-2222-4222-8222-222222222222';
const schemas = createPublicCartRelaySchemas({
  merchantSlug: 'synthetic',
  productId,
  variantId,
});
const line = { item: { productId, variantId }, quantity: 1 };

it('accepts only the selected product and variant in cart writes', () => {
  const create = { operationId: 'create', currency: 'NGN', lines: [line] };
  expect(schemas.create.parse(create)).toEqual(create);
  const command = {
    operationId: 'add',
    expectedVersion: 1,
    command: { ...line, type: 'add' },
  };
  expect(schemas.command.parse(command)).toEqual(command);
  for (const patch of [{ item: { productId } }, { quantity: 2 }]) {
    expect(
      schemas.command.safeParse({
        ...command,
        command: { ...command.command, ...patch },
      }).success
    ).toBe(false);
  }
});

it('validates merchant bootstrap, checkout preparation and the bound launch', () => {
  expect(schemas.bootstrap.safeParse({ merchantSlug: 'other' }).success).toBe(
    false
  );
  expect(schemas.bootstrap.parse({ merchantSlug: 'synthetic' })).toEqual({
    merchantSlug: 'synthetic',
  });
  const review = {
    operationId: 'review',
    expectedVersion: 1,
    cartId: productId,
  };
  expect(schemas.review.parse(review)).toEqual(review);
  expect(
    schemas.review.safeParse({ ...review, expectedVersion: 0 }).success
  ).toBe(false);
  const buildDigest = 'a'.repeat(64);
  const launch = schemas.launch(buildDigest, '/pages/story');
  expect(launch.parse({ buildDigest, path: '/pages/story' })).toEqual({
    buildDigest,
    path: '/pages/story',
  });
  expect(launch.safeParse({ buildDigest, path: '/' }).success).toBe(false);
});
