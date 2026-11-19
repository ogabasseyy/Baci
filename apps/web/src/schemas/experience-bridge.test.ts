import { describe, expect, it } from 'vitest';
import { parseBridgeRequest } from './experience-bridge';

const request = () => ({
  protocol: 'baci-commerce/1',
  instanceId: 'instance-1',
  buildDigest: 'a'.repeat(64),
  routeEpoch: 1,
  requestId: 'request-1',
  capability: 'cart.mutate',
  method: 'cart.add',
  args: { productId: 'product-1', quantity: 1 },
});
describe('experience bridge input', () => {
  it('accepts a minimal public cart command', () => {
    expect(parseBridgeRequest(request()).args).toEqual({
      productId: 'product-1',
      quantity: 1,
    });
  });
  it('rejects_body_selected_tenant_price_and_unknown_method', () => {
    for (const args of [
      { ...request().args, merchantId: 'foreign' },
      { ...request().args, price: 1 },
      { ...request().args, token: 'secret' },
    ])
      expect(() => parseBridgeRequest({ ...request(), args })).toThrow();
    expect(() =>
      parseBridgeRequest({ ...request(), method: 'orders.create' })
    ).toThrow();
    expect(() =>
      parseBridgeRequest({ ...request(), capability: 'catalog.read' })
    ).toThrow();
    expect(() => parseBridgeRequest({ ...request(), routeEpoch: 0 })).toThrow();
    expect(() =>
      parseBridgeRequest({
        ...request(),
        args: { productId: 'x', quantity: 1.5 },
      })
    ).toThrow();
    expect(() =>
      parseBridgeRequest({
        ...request(),
        args: { productId: 'x', quantity: 0 },
      })
    ).toThrow();
  });
  it('bounds payload before parsing and validates navigation intents', () => {
    expect(() =>
      parseBridgeRequest({ ...request(), requestId: 'x'.repeat(70000) })
    ).toThrow();
    expect(
      parseBridgeRequest({
        ...request(),
        capability: 'navigation',
        method: 'navigation.go',
        args: { path: '/products/device' },
      }).method
    ).toBe('navigation.go');
    for (const path of [
      'https://evil.invalid',
      '//evil.invalid',
      '/\\evil.invalid',
    ])
      expect(() =>
        parseBridgeRequest({
          ...request(),
          capability: 'navigation',
          method: 'navigation.open',
          args: { path },
        })
      ).toThrow();
  });
});

it('admits only bound cart reconciliation IDs under mutate capability', () => {
  const valid = {
    ...request(),
    method: 'cart.reconcile',
    args: { operationId: 'original-operation' },
  };
  expect(parseBridgeRequest(valid).args).toEqual({
    operationId: 'original-operation',
  });
  for (const invalid of [
    { ...valid, capability: 'cart.read-public' },
    { ...valid, args: { operationId: '' } },
    { ...valid, args: { operationId: 'x'.repeat(101) } },
    {
      ...valid,
      args: { operationId: 'original-operation', merchantId: 'other' },
    },
  ])
    expect(() => parseBridgeRequest(invalid)).toThrow();
});
