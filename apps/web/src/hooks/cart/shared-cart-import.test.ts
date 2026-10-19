import type { CartLine, CartSnapshot } from '@baci/shared/cart';
import { describe, expect, it } from 'vitest';
import type { Product } from '@/lib/products';
import type { CartItem } from './cart-types';
import { displayLineToInputLine } from './shared-cart-import';

import { planLegacyImport } from './shared-cart-reducer';

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';

const CART_ID = '22222222-2222-4222-8222-222222222222';

function product(overrides: Record<string, unknown> = {}): Product {
  return {
    brand: 'Brand',
    description: '',
    gtin: '',
    id: 'prod-1',
    image: '/prod-1.png',
    imageHint: 'product',
    imageLarge: '/prod-1-large.png',
    manage_stock: false,
    mpn: '',
    name: 'Phone',
    price: 100,
    slug: 'phone',
    status: 'active',
    stock: 10,
    ...overrides,
  } as Product;
}

function cartItem(overrides: Record<string, unknown> = {}): CartItem {
  return {
    ...product(),
    cartItemId: 'prod-1',
    quantity: 1,
    ...overrides,
  } as CartItem;
}

function cartLine(overrides: Record<string, unknown> = {}): CartLine {
  return {
    id: 'line-1',
    item: { productId: 'prod-1' },
    lineTotalMinor: 10000,
    quantity: 1,
    unitPriceMinor: 10000,
    ...overrides,
  } as CartLine;
}

function snapshot(overrides: Record<string, unknown> = {}): CartSnapshot {
  const lines = (overrides.lines as CartLine[] | undefined) ?? [cartLine()];
  const subtotalMinor = lines.reduce(
    (sum, line) => sum + line.lineTotalMinor,
    0
  );
  return {
    cartId: CART_ID,
    currency: 'NGN',
    estimatedTotals: false,
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    lines,
    merchantId: MERCHANT_ID,
    state: 'active',
    subtotalMinor,
    totalMinor: subtotalMinor,
    version: 3,
    ...overrides,
  } as CartSnapshot;
}

describe('planLegacyImport', () => {
  it('returns nothing when the legacy cache is empty', () => {
    expect(planLegacyImport([], null, null)).toEqual({ kind: 'nothing' });
  });

  it('plans a create-with-lines import with a stable operation key', () => {
    const local = [
      cartItem({ id: 'prod-1', quantity: 2 }),
      cartItem({
        id: 'prod-2',
        negotiatedPrice: 50,
        negotiationStatus: 'accepted',
        quantity: 1,
      }),
    ];
    const first = planLegacyImport(local, null, null);
    const second = planLegacyImport(local, null, null);

    expect(first).toMatchObject({ kind: 'create' });
    if (first.kind !== 'create' || second.kind !== 'create') {
      throw new Error('expected create plans');
    }
    expect(first.lines).toHaveLength(2);
    expect(first.lines[0]).toMatchObject({ quantity: 2 });
    expect(first.lines[1].negotiatedUnitPriceMinor).toBe(5000);
    // A free (fully discounted) accepted negotiation keeps its zero
    // attachment instead of reverting to catalog pricing.
    const free = planLegacyImport(
      [cartItem({ negotiatedPrice: 0, negotiationStatus: 'accepted' })],
      null,
      null
    );
    if (free.kind !== 'create') throw new Error('expected create plan');
    expect(free.lines[0].negotiatedUnitPriceMinor).toBe(0);
    expect(free.lines[0].negotiationStatus).toBe('accepted');
    // Derived keys converge retries instead of duplicating the import.
    expect(first.operationId).toBe(second.operationId);
    expect(first.operationId.length).toBeLessThanOrEqual(128);
  });

  it('plans per-line adds when the server cart exists but is empty', () => {
    const planned = planLegacyImport(
      [cartItem({ id: 'prod-1', quantity: 2 })],
      snapshot({ lines: [], version: 1 }),
      CART_ID
    );

    expect(planned).toMatchObject({ kind: 'commands' });
    if (planned.kind !== 'commands') throw new Error('expected commands plan');
    expect(planned.adds).toHaveLength(1);
    expect(planned.sets).toHaveLength(0);
    expect(planned.adds[0].operationId).toContain(CART_ID);
  });

  it('diffs a nonempty server cart into adds and quantity sets', () => {
    const planned = planLegacyImport(
      [
        cartItem({ id: 'prod-1', quantity: 3 }),
        cartItem({ id: 'prod-9', quantity: 1 }),
      ],
      snapshot({ version: 2 }),
      CART_ID
    );

    expect(planned).toMatchObject({ kind: 'commands' });
    if (planned.kind !== 'commands') throw new Error('expected commands plan');
    // prod-1 exists with qty 1 locally 3 → max wins via set to 3.
    expect(planned.sets).toEqual([{ lineId: 'line-1', quantity: 3 }]);
    expect(planned.adds).toHaveLength(1);
    expect(planned.adds[0].line.item).toEqual({ productId: 'prod-9' });
  });

  it('reports conflicts instead of silently overwriting attachments', () => {
    const planned = planLegacyImport(
      [
        cartItem({
          id: 'prod-1',
          quantity: 1,
          quizAwardId: 'award-1',
          quizVoucherToken: 'token-1',
        }),
      ],
      snapshot({ version: 2 }),
      CART_ID
    );

    expect(planned).toMatchObject({ kind: 'conflicts' });
    if (planned.kind !== 'conflicts') {
      throw new Error('expected conflicts plan');
    }
    expect(planned.conflicts).toHaveLength(1);
    expect(planned.conflicts[0].item).toEqual({ productId: 'prod-1' });
  });

  it('blocks beyond the line cap instead of truncating lines', () => {
    const local = Array.from({ length: 25 }, (_, index) =>
      cartItem({ id: `prod-${index}`, quantity: 1 })
    );
    const planned = planLegacyImport(local, null, null);

    expect(planned).toMatchObject({
      kind: 'blocked',
      code: 'too_many_lines',
      lineCount: 25,
    });
  });
});

it('keeps quantity for partial voucher pairs when adopting a legacy line', () => {
  expect(
    displayLineToInputLine(
      cartItem({ quizVoucherToken: 'voucher', quantity: 3 })
    )
  ).toMatchObject({ quantity: 3 });
  expect(
    displayLineToInputLine(
      cartItem({
        quizVoucherToken: 'voucher',
        quizAwardId: 'award',
        quantity: 3,
      })
    )
  ).toMatchObject({ quantity: 1 });
});

it('preserves selected assurance when adopting a legacy line', () => {
  expect(
    displayLineToInputLine(cartItem({ hasAssurance: true }))
  ).toMatchObject({ hasAssurance: true });
});
it('uses a distinct adoption key when coverage changes', () => {
  const ordinary = planLegacyImport([cartItem()], null, null);
  const insured = planLegacyImport(
    [cartItem({ hasAssurance: true })],
    null,
    null
  );
  expect(ordinary.kind).toBe('create');
  expect(insured.kind).toBe('create');
  if (ordinary.kind === 'create' && insured.kind === 'create')
    expect(insured.operationId).not.toBe(ordinary.operationId);
});
it('persists imported coverage when its product already exists on the server', () => {
  const planned = planLegacyImport(
    [cartItem({ hasAssurance: true })],
    snapshot({ version: 2 }),
    CART_ID
  );
  expect(planned).toMatchObject({
    kind: 'commands',
    assurances: [{ lineId: 'line-1', hasAssurance: true }],
  });
});
it('keeps quantity and coverage changes on their attachment-distinct server siblings', () => {
  const server = snapshot({
    lines: [
      cartLine({ id: 'ordinary', quantity: 1, hasAssurance: false }),
      cartLine({
        id: 'award',
        voucherToken: 'voucher',
        quantity: 1,
        hasAssurance: false,
      }),
    ],
  });
  const planned = planLegacyImport(
    [
      cartItem({ quantity: 3, hasAssurance: true }),
      cartItem({ quizVoucherToken: 'voucher', quantity: 1 }),
    ],
    server,
    CART_ID
  );
  expect(planned).toMatchObject({
    kind: 'commands',
    sets: [{ lineId: 'ordinary', quantity: 3 }],
    assurances: [{ lineId: 'ordinary', hasAssurance: true }],
    adds: [],
  });
});
it('uses distinct stable add receipts for voucher and negotiation siblings', () => {
  const local = [
    cartItem({ id: 'prod-9' }),
    cartItem({ id: 'prod-9', quizVoucherToken: 'voucher' }),
    cartItem({
      id: 'prod-9',
      negotiatedPrice: 50,
      negotiationStatus: 'accepted',
    }),
  ];
  const first = planLegacyImport(local, snapshot(), CART_ID);
  const retry = planLegacyImport([...local].reverse(), snapshot(), CART_ID);
  expect(first.kind).toBe('commands');
  expect(retry.kind).toBe('commands');
  if (first.kind !== 'commands' || retry.kind !== 'commands') return;
  expect(first.adds).toHaveLength(3);
  expect(new Set(first.adds.map((add) => add.operationId)).size).toBe(3);
  expect(first.adds.map((add) => add.operationId).sort()).toEqual(
    retry.adds.map((add) => add.operationId).sort()
  );
});
it('keeps negotiated sibling quantities and coverage independent of ordinary lines', () => {
  const server = snapshot({
    lines: [
      cartLine({ id: 'ordinary', quantity: 1 }),
      cartLine({
        id: 'negotiated',
        negotiatedUnitPriceMinor: 5000,
        negotiationStatus: 'accepted',
        quantity: 2,
      }),
    ],
  });
  const planned = planLegacyImport(
    [
      cartItem({ quantity: 3 }),
      cartItem({
        negotiatedPrice: 50,
        negotiationStatus: 'accepted',
        quantity: 4,
        hasAssurance: true,
      }),
    ],
    server,
    CART_ID
  );
  expect(planned).toMatchObject({
    kind: 'commands',
    adds: [],
    sets: [
      { lineId: 'ordinary', quantity: 3 },
      { lineId: 'negotiated', quantity: 4 },
    ],
    assurances: [{ lineId: 'negotiated', hasAssurance: true }],
  });
});
it('atomically replaces a lone conflicting offer when the device wins even at equal quantity and coverage', () => {
  const local = [
    cartItem({ negotiatedPrice: 50, negotiationStatus: 'accepted' }),
  ];
  const server = snapshot({ version: 7 });
  const planned = planLegacyImport(local, server, CART_ID, [
    { item: { productId: 'prod-1' }, keep: 'incoming' },
  ]);
  expect(planned).toMatchObject({
    kind: 'commands',
    replacement: {
      expectedVersion: 7,
      lines: [
        { negotiatedUnitPriceMinor: 5000, negotiationStatus: 'accepted' },
      ],
    },
  });
  expect(
    planLegacyImport(local, server, CART_ID, [
      { item: { productId: 'prod-1' }, keep: 'incoming' },
    ])
  ).toEqual(planned);
  expect(
    planLegacyImport(local, server, CART_ID, [
      { item: { productId: 'prod-1' }, keep: 'existing' },
    ])
  ).not.toHaveProperty('replacement');
});
it('preserves unrelated negotiation siblings when replacing a lone voucher conflict', () => {
  const server = snapshot({
    lines: [
      cartLine({ id: 'chosen' }),
      cartLine({ id: 'regular-9', item: { productId: 'prod-9' }, quantity: 2 }),
      cartLine({
        id: 'negotiated-9',
        item: { productId: 'prod-9' },
        quantity: 4,
        negotiatedUnitPriceMinor: 5000,
        negotiationStatus: 'accepted',
      }),
    ],
  });
  const planned = planLegacyImport(
    [cartItem({ quizVoucherToken: 'chosen-voucher' })],
    server,
    CART_ID,
    [{ item: { productId: 'prod-1' }, keep: 'incoming' }]
  );
  expect(planned).toMatchObject({
    replacement: {
      lines: expect.arrayContaining([
        { item: { productId: 'prod-9' }, quantity: 2 },
        {
          item: { productId: 'prod-9' },
          quantity: 4,
          negotiatedUnitPriceMinor: 5000,
          negotiationStatus: 'accepted',
        },
      ]),
    },
  });
});
it('uses an atomic import when a newly added line carries selected coverage', () => {
  const planned = planLegacyImport(
    [cartItem({ id: 'prod-9', hasAssurance: true })],
    snapshot({ version: 4 }),
    CART_ID
  );
  expect(planned).toMatchObject({
    kind: 'commands',
    adds: [],
    replacement: {
      expectedVersion: 4,
      lines: expect.arrayContaining([
        { item: { productId: 'prod-9' }, quantity: 1, hasAssurance: true },
      ]),
    },
  });
});

it('reports capacity for a full server and legal attachment siblings, preserving every device line for retry', () => {
  const local = [
    cartItem({
      id: 'prod-1',
      quizAwardId: 'award-a',
      quizVoucherToken: 'token-a',
    }),
    cartItem({
      id: 'prod-1',
      quizAwardId: 'award-b',
      quizVoucherToken: 'token-b',
      hasAssurance: true,
    }),
  ];
  const original = structuredClone(local);
  const full = snapshot({
    lines: Array.from({ length: 20 }, (_, index) =>
      cartLine({
        id: `server-${index}`,
        item: { productId: `prod-${index + 1}` },
      })
    ),
  });
  expect(planLegacyImport(local, full, CART_ID)).toEqual({
    kind: 'blocked',
    code: 'too_many_lines',
    lineCount: 22,
  });
  expect(local).toEqual(original);
  const room = {
    ...full,
    lines: full.lines.slice(0, 18),
    version: full.version + 1,
  };
  const retry = planLegacyImport(local, room, CART_ID);
  expect(retry.kind).toBe('commands');
  if (retry.kind !== 'commands')
    throw new Error('expected import after making room');
  expect(
    retry.replacement?.lines.filter((line) => line.voucherToken)
  ).toHaveLength(2);
  expect(
    retry.replacement?.lines.find((line) => line.voucherToken === 'token-b')
      ?.hasAssurance
  ).toBe(true);
});
it('does not silently omit a local-only line when the server cart is full', () => {
  const full = snapshot({
    lines: Array.from({ length: 20 }, (_, index) =>
      cartLine({
        id: `server-${index}`,
        item: { productId: `server-product-${index}` },
      })
    ),
  });
  expect(
    planLegacyImport([cartItem({ id: 'device-only' })], full, CART_ID)
  ).toMatchObject({ kind: 'blocked', code: 'too_many_lines' });
});
