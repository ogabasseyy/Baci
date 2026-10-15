import type { CartLine, CartSnapshot } from '@baci/shared/cart';
import { nativeWriteCommand, snapshotInputLines } from './write-command';

const line = (overrides: Record<string, unknown> = {}): CartLine =>
  ({
    id: 'line-1',
    item: { productId: 'prod-1' },
    quantity: 2,
    unitPriceMinor: 1000,
    lineTotalMinor: 2000,
    ...overrides,
  }) as CartLine;

const snapshot = (lines: CartLine[] = [line()]): CartSnapshot =>
  ({
    cartId: '22222222-2222-4222-8222-222222222222',
    currency: 'NGN',
    estimatedTotals: false,
    expiresAt: '2099-01-01T00:00:00.000Z',
    lines,
    merchantId: '11111111-1111-4111-8111-111111111111',
    state: 'active',
    subtotalMinor: 2000,
    totalMinor: 2000,
    version: 1,
  }) as CartSnapshot;

it('maps an add action to a cart command', () => {
  expect(
    nativeWriteCommand(
      { type: 'add', item: { product_id: 'prod-1', quantity: 3 } as never },
      snapshot()
    )
  ).toEqual({ type: 'add', item: { productId: 'prod-1' }, quantity: 3 });
});

it('maps clear and pins voucher adds to one unit', () => {
  expect(nativeWriteCommand({ type: 'clear' }, snapshot())).toEqual({
    type: 'clear',
  });
  expect(
    nativeWriteCommand(
      {
        type: 'add',
        item: {
          product_id: 'prod-1',
          quantity: 5,
          voucher_token: 'tok-1',
        } as never,
      },
      snapshot()
    )
  ).toMatchObject({ type: 'add', quantity: 1, voucherToken: 'tok-1' });
});

it('toggles assurance from the confirmed line state', () => {
  expect(
    nativeWriteCommand({ type: 'assurance', id: 'line-1' }, snapshot())
  ).toEqual({ type: 'set_assurance', lineId: 'line-1', hasAssurance: true });
  expect(
    nativeWriteCommand(
      { type: 'assurance', id: 'line-1' },
      snapshot([line({ hasAssurance: true })])
    )
  ).toEqual({ type: 'set_assurance', lineId: 'line-1', hasAssurance: false });
  expect(
    nativeWriteCommand({ type: 'assurance', id: 'missing' }, snapshot())
  ).toBeNull();
});

it('maps quantity edits and removals with line existence checks', () => {
  expect(
    nativeWriteCommand(
      { type: 'quantity', id: 'line-1', quantity: 5 },
      snapshot()
    )
  ).toEqual({ type: 'set_quantity', lineId: 'line-1', quantity: 5 });
  expect(
    nativeWriteCommand(
      { type: 'quantity', id: 'line-1', quantity: 0 },
      snapshot()
    )
  ).toEqual({ type: 'remove', lineId: 'line-1' });
  expect(
    nativeWriteCommand({ type: 'remove', id: 'missing' }, snapshot())
  ).toBeNull();
});

it('rebuilds a replace command for line and group negotiation', () => {
  expect(
    nativeWriteCommand(
      { type: 'negotiate', id: 'line-1', price: 12.5 },
      snapshot()
    )
  ).toEqual({
    type: 'replace',
    lines: [
      {
        item: { productId: 'prod-1' },
        quantity: 2,
        negotiatedUnitPriceMinor: 1250,
        negotiationStatus: 'accepted',
      },
    ],
  });
  expect(
    nativeWriteCommand({ type: 'clear_negotiation', id: 'line-1' }, snapshot())
  ).toEqual({
    type: 'replace',
    lines: [{ item: { productId: 'prod-1' }, quantity: 2 }],
  });
  expect(
    nativeWriteCommand({ type: 'negotiate_group', total: 10 }, snapshot())
  ).toEqual({
    type: 'replace',
    lines: [
      {
        item: { productId: 'prod-1' },
        quantity: 2,
        negotiatedUnitPriceMinor: 500,
        negotiationStatus: 'accepted',
      },
    ],
  });
});

it('rejects invalid negotiation amounts', () => {
  expect(() =>
    nativeWriteCommand(
      { type: 'negotiate', id: 'line-1', price: -1 },
      snapshot()
    )
  ).toThrow();
  expect(() =>
    nativeWriteCommand(
      { type: 'negotiate_group', total: 10 },
      snapshot([line({ lineTotalMinor: 0 })])
    )
  ).toThrow();
});

it('projects snapshot lines into replace inputs', () => {
  expect(snapshotInputLines(snapshot())).toEqual([
    { item: { productId: 'prod-1' }, quantity: 2 },
  ]);
});
