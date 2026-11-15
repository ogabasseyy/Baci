import { describe, expect, it } from 'vitest';
import {
  applyCartPeerPreview,
  buildCartPeerLines,
  readCartPeerMessage,
} from './cart-peer-preview';
import type { SharedCartDisplayItem } from './cart-types';

function line(
  serverLineId: string | undefined,
  quantity: number,
  extra: Partial<SharedCartDisplayItem> = {}
): SharedCartDisplayItem {
  return {
    cartItemId: serverLineId ?? 'local',
    id: `product-${serverLineId ?? 'local'}`,
    name: 'Phone',
    pendingTempId: null,
    price: 100,
    quantity,
    serverLineId,
    ...extra,
  } as SharedCartDisplayItem;
}

describe('cart peer preview messages', () => {
  it('reads a well-formed edit and settled message', () => {
    expect(
      readCartPeerMessage({
        cartId: 'c',
        kind: 'edit',
        lines: [{ id: 'l1', quantity: 2 }],
        merchantId: 'm',
        version: 3,
      })
    ).toEqual({
      cartId: 'c',
      kind: 'edit',
      lines: [{ id: 'l1', quantity: 2 }],
      merchantId: 'm',
      version: 3,
    });
    expect(
      readCartPeerMessage({
        cartId: 'c',
        kind: 'settled',
        merchantId: 'm',
        version: 4,
      })
    ).toEqual({ cartId: 'c', kind: 'settled', merchantId: 'm', version: 4 });
  });

  it.each([
    null,
    'edit',
    { kind: 'other', cartId: 'c', merchantId: 'm', version: 1 },
    { kind: 'settled', cartId: '', merchantId: 'm', version: 1 },
    { kind: 'settled', cartId: 'c', merchantId: 'm', version: 1.5 },
    { kind: 'settled', cartId: 'c', merchantId: 'm', version: -1 },
    { kind: 'edit', cartId: 'c', merchantId: 'm', version: 1 },
    {
      kind: 'edit',
      cartId: 'c',
      merchantId: 'm',
      version: 1,
      lines: [{ id: 'l1', quantity: 0 }],
    },
    {
      kind: 'edit',
      cartId: 'c',
      merchantId: 'm',
      version: 1,
      lines: [{ id: 'l1', quantity: 11 }],
    },
    {
      kind: 'edit',
      cartId: 'c',
      merchantId: 'm',
      version: 1,
      lines: [{ id: 7, quantity: 1 }],
    },
  ])('rejects malformed message %#', (value) => {
    expect(readCartPeerMessage(value)).toBeNull();
  });

  it('sends only confirmed server lines', () => {
    expect(
      buildCartPeerLines([
        line('l1', 2),
        line(undefined, 1),
        line('l3', 1, { pendingTempId: 'temp-1' }),
      ])
    ).toEqual([{ id: 'l1', quantity: 2 }]);
  });
});

describe('applyCartPeerPreview', () => {
  it('takes quantities and removals for lines this tab already holds', () => {
    const display = [line('l1', 1), line('l2', 1), line('l3', 4)];
    const shown = applyCartPeerPreview(display, [
      { id: 'l1', quantity: 3 },
      { id: 'l3', quantity: 4 },
    ]);
    expect(shown.map((item) => [item.serverLineId, item.quantity])).toEqual([
      ['l1', 3],
      ['l3', 4],
    ]);
    // Untouched lines keep their identity so they do not re-render.
    expect(shown[1]).toBe(display[2]);
  });

  it('never adds a line and leaves device-only lines alone', () => {
    const display = [line(undefined, 2), line('l1', 1)];
    const shown = applyCartPeerPreview(display, [
      { id: 'l1', quantity: 1 },
      { id: 'unknown', quantity: 5 },
    ]);
    expect(shown).toEqual(display);
  });
});
