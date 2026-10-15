import type { CartLine, CartSnapshot } from '@baci/shared/cart';

import { describe, expect, it } from 'vitest';

import type { Product } from '@/lib/products';

import {
  deriveSyncStatus,
  initialSharedCartState,
  sharedCartReducer,
} from './shared-cart-reducer';

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
    expiresAt: '2026-10-19T04:00:00.000Z',
    lines,
    merchantId: MERCHANT_ID,
    state: 'active',
    subtotalMinor,
    totalMinor: subtotalMinor,
    version: 3,
    ...overrides,
  } as CartSnapshot;
}

function linked(version = 3, lines: CartLine[] = [cartLine()]) {
  let state = initialSharedCartState;
  state = sharedCartReducer(state, {
    cached: [],
    generation: 1,
    merchantId: MERCHANT_ID,
    products: {},
    type: 'link/start',
  });
  return sharedCartReducer(state, {
    generation: 1,
    snapshot: snapshot({ lines, version }),
    type: 'link/snapshot',
  });
}

describe('shared-cart-reducer reconcile', () => {
  it('adopts a newer snapshot and resolves the temp line id', () => {
    const added = sharedCartReducer(linked(3, []), {
      entry: {
        intent: {
          kind: 'add',
          product: product({ id: 'prod-9', price: 250 }),
          quantity: 2,
          tempId: 'temp-1',
        },
        operationId: 'op-1',
      },
      generation: 1,
      type: 'command/enqueue',
    });

    const state = sharedCartReducer(added, {
      generation: 1,
      operationId: 'op-1',
      snapshot: snapshot({
        lines: [
          cartLine({
            id: 'server-line-9',
            item: { productId: 'prod-9' },
            lineTotalMinor: 50000,
            quantity: 2,
            unitPriceMinor: 25000,
          }),
        ],
        version: 4,
      }),
      type: 'command/reconciled',
    });

    expect(state.queue).toHaveLength(0);
    expect(state.confirmed?.version).toBe(4);
    expect(state.display).toHaveLength(1);
    expect(state.display[0]).toMatchObject({
      id: 'prod-9',
      pendingTempId: null,
      price: 250,
      quantity: 2,
      serverLineId: 'server-line-9',
    });
    expect(state.display[0].cartItemId).toBe('server-line-9');
    expect(deriveSyncStatus(state)).toBe('synced');
  });

  it('unblocks dependents with the stable server line id', () => {
    const added = sharedCartReducer(linked(3, []), {
      entry: {
        intent: {
          kind: 'add',
          product: product(),
          quantity: 1,
          tempId: 'temp-1',
        },
        operationId: 'op-1',
      },
      generation: 1,
      type: 'command/enqueue',
    });
    const queued = sharedCartReducer(added, {
      entry: {
        intent: {
          kind: 'set_quantity',
          quantity: 3,
          target: { kind: 'temp', tempId: 'temp-1' },
        },
        operationId: 'op-2',
      },
      generation: 1,
      type: 'command/enqueue',
    });

    const state = sharedCartReducer(queued, {
      generation: 1,
      operationId: 'op-1',
      snapshot: snapshot({ version: 4 }),
      type: 'command/reconciled',
    });

    expect(state.queue).toHaveLength(1);
    expect(state.queue[0].operationId).toBe('op-2');
    expect(state.queue[0]).not.toHaveProperty('blockedOnTempId');
    expect(state.queue[0].intent).toMatchObject({
      kind: 'set_quantity',
      quantity: 3,
      target: { kind: 'lineId', lineId: 'line-1' },
    });
    // The dependent intent still applies on top of the confirmed line.
    expect(state.display[0].quantity).toBe(3);
  });

  it('drops the entry but keeps the newer snapshot on a lower-version response', () => {
    const added = sharedCartReducer(linked(5), {
      entry: {
        intent: {
          kind: 'add',
          product: product({ id: 'prod-9' }),
          quantity: 1,
          tempId: 'temp-1',
        },
        operationId: 'op-1',
      },
      generation: 1,
      type: 'command/enqueue',
    });

    // A replayed outcome from an older commit: the operation did land,
    // but this client already holds a newer snapshot from elsewhere.
    const state = sharedCartReducer(added, {
      generation: 1,
      operationId: 'op-1',
      snapshot: snapshot({ version: 4 }),
      type: 'command/reconciled',
    });

    expect(state.queue).toHaveLength(0);
    expect(state.confirmed?.version).toBe(5);
    // The temp line is gone: its entry reconciled, so nothing pending
    // re-applies it, and the kept snapshot is authoritative.
    expect(state.display.map((line) => line.id)).toEqual(['prod-1']);
  });

  it('fails dependents when the confirmed line vanished concurrently', () => {
    const added = sharedCartReducer(linked(3, []), {
      entry: {
        intent: {
          kind: 'add',
          product: product({ id: 'prod-9' }),
          quantity: 1,
          tempId: 'temp-1',
        },
        operationId: 'op-1',
      },
      generation: 1,
      type: 'command/enqueue',
    });
    const queued = sharedCartReducer(added, {
      entry: {
        intent: {
          kind: 'set_quantity',
          quantity: 3,
          target: { kind: 'temp', tempId: 'temp-1' },
        },
        operationId: 'op-2',
      },
      generation: 1,
      type: 'command/enqueue',
    });
    // Adopt a newer snapshot first (another device removed the line
    // right after our add committed but before we reconciled it).
    const polled = sharedCartReducer(queued, {
      generation: 1,
      snapshot: snapshot({ lines: [], version: 6 }),
      type: 'snapshot/polled',
    });

    const state = sharedCartReducer(polled, {
      generation: 1,
      operationId: 'op-1',
      snapshot: snapshot({
        lines: [
          cartLine({
            id: 'server-line-9',
            item: { productId: 'prod-9' },
          }),
        ],
        version: 4,
      }),
      type: 'command/reconciled',
    });

    expect(state.queue).toHaveLength(0);
    expect(state.confirmed?.version).toBe(6);
    expect(state.syncError).toBe('not_found');
    expect(deriveSyncStatus(state)).toBe('error');
    expect(state.display).toHaveLength(0);
  });

  it('rebases the entry on a version conflict and retries with the same key', () => {
    const added = sharedCartReducer(linked(), {
      entry: {
        intent: {
          kind: 'add',
          product: product({ id: 'prod-9' }),
          quantity: 1,
          tempId: 'temp-1',
        },
        operationId: 'op-1',
      },
      generation: 1,
      type: 'command/enqueue',
    });

    const state = sharedCartReducer(added, {
      generation: 1,
      operationId: 'op-1',
      snapshot: snapshot({ version: 5 }),
      type: 'command/conflict',
    });

    expect(state.confirmed?.version).toBe(5);
    expect(state.queue).toHaveLength(1);
    expect(state.queue[0]).toMatchObject({
      attempts: 1,
      operationId: 'op-1',
      state: 'queued',
    });
    expect(state.syncError).toBeNull();
    expect(deriveSyncStatus(state)).toBe('pending');
    // The optimistic line survives the rebase.
    expect(state.display.map((line) => line.id)).toEqual(['prod-1', 'prod-9']);
  });

  it('gives up after repeated conflicts instead of retrying forever', () => {
    let state = sharedCartReducer(linked(), {
      entry: {
        intent: {
          kind: 'add',
          product: product({ id: 'prod-9' }),
          quantity: 1,
          tempId: 'temp-1',
        },
        operationId: 'op-1',
      },
      generation: 1,
      type: 'command/enqueue',
    });
    for (let version = 4; version <= 7; version += 1) {
      state = sharedCartReducer(state, {
        generation: 1,
        operationId: 'op-1',
        snapshot: snapshot({ version }),
        type: 'command/conflict',
      });
    }

    expect(state.queue).toHaveLength(0);
    expect(state.syncError).toBe('version_conflict');
    expect(deriveSyncStatus(state)).toBe('error');
    expect(state.display.map((line) => line.id)).toEqual(['prod-1']);
  });
});

describe('shared-cart-reducer failure and retry', () => {
  it('keeps retryable entries queued with a visible retry state', () => {
    const added = sharedCartReducer(linked(), {
      entry: {
        intent: {
          kind: 'add',
          product: product({ id: 'prod-9' }),
          quantity: 1,
          tempId: 'temp-1',
        },
        operationId: 'op-1',
      },
      generation: 1,
      type: 'command/enqueue',
    });
    const failed = sharedCartReducer(added, {
      code: 'temporarily_unavailable',
      generation: 1,
      operationId: 'op-1',
      retryable: true,
      type: 'command/failed',
    });

    expect(failed.queue).toHaveLength(1);
    expect(failed.queue[0].state).toBe('failed');
    expect(failed.queue[0].attempts).toBe(1);
    expect(failed.syncError).toBe('temporarily_unavailable');
    expect(deriveSyncStatus(failed)).toBe('retrying');
    // The last confirmed cart plus the still-pending intent stays visible;
    // the retrying status says the temp line is not committed yet.
    expect(failed.display.map((line) => line.id)).toEqual(['prod-1', 'prod-9']);

    const retried = sharedCartReducer(failed, {
      generation: 1,
      operationId: 'op-1',
      type: 'command/retry',
    });
    expect(retried.queue[0].state).toBe('queued');
    expect(deriveSyncStatus(retried)).toBe('pending');
  });

  it('rolls back fatal entries and cascades to their dependents', () => {
    const added = sharedCartReducer(linked(3, []), {
      entry: {
        intent: {
          kind: 'add',
          product: product(),
          quantity: 1,
          tempId: 'temp-1',
        },
        operationId: 'op-1',
      },
      generation: 1,
      type: 'command/enqueue',
    });
    const queued = sharedCartReducer(added, {
      entry: {
        intent: {
          kind: 'set_quantity',
          quantity: 3,
          target: { kind: 'temp', tempId: 'temp-1' },
        },
        operationId: 'op-2',
      },
      generation: 1,
      type: 'command/enqueue',
    });

    const state = sharedCartReducer(queued, {
      code: 'invalid_item',
      generation: 1,
      operationId: 'op-1',
      retryable: false,
      type: 'command/failed',
    });

    expect(state.queue).toHaveLength(0);
    expect(state.syncError).toBe('invalid_item');
    expect(deriveSyncStatus(state)).toBe('error');
    expect(state.display).toHaveLength(0);
  });

  it('clears the error on the next successful reconcile', () => {
    const failed = sharedCartReducer(linked(3, []), {
      entry: {
        intent: {
          kind: 'add',
          product: product(),
          quantity: 1,
          tempId: 'temp-1',
        },
        operationId: 'op-1',
      },
      generation: 1,
      type: 'command/enqueue',
    });
    const errored = sharedCartReducer(failed, {
      code: 'invalid_item',
      generation: 1,
      operationId: 'op-1',
      retryable: false,
      type: 'command/failed',
    });
    expect(errored.syncError).toBe('invalid_item');

    const added = sharedCartReducer(errored, {
      entry: {
        intent: {
          kind: 'add',
          product: product({ id: 'prod-9' }),
          quantity: 1,
          tempId: 'temp-2',
        },
        operationId: 'op-2',
      },
      generation: 1,
      type: 'command/enqueue',
    });
    const state = sharedCartReducer(added, {
      generation: 1,
      operationId: 'op-2',
      snapshot: snapshot({
        lines: [cartLine({ id: 'line-9', item: { productId: 'prod-9' } })],
        version: 4,
      }),
      type: 'command/reconciled',
    });

    expect(state.syncError).toBeNull();
    expect(deriveSyncStatus(state)).toBe('synced');
  });
});

describe('temp targets for coverage and repricing', () => {
  it.each([
    'set_assurance',
    'set_negotiated_price',
  ] as const)('resolves %s after its optimistic add', (kind) => {
    const added = sharedCartReducer(linked(3, []), {
      type: 'command/enqueue',
      generation: 1,
      entry: {
        operationId: 'add',
        intent: {
          kind: 'add',
          product: product(),
          quantity: 1,
          tempId: 'temp',
        },
      },
    });
    const intent =
      kind === 'set_assurance'
        ? {
            kind,
            hasAssurance: true,
            target: { kind: 'temp' as const, tempId: 'temp' },
          }
        : {
            kind,
            negotiatedUnitPriceMinor: 5000,
            target: { kind: 'temp' as const, tempId: 'temp' },
          };
    const queued = sharedCartReducer(added, {
      type: 'command/enqueue',
      generation: 1,
      entry: { operationId: 'edit', intent },
    });
    expect(queued.queue[1].blockedOnTempId).toBe('temp');
    const settled = sharedCartReducer(queued, {
      type: 'command/reconciled',
      generation: 1,
      operationId: 'add',
      snapshot: snapshot({ version: 4 }),
    });
    expect(settled.queue[0].intent).toMatchObject({
      target: { kind: 'lineId', lineId: 'line-1' },
    });
  });
});
it('keeps a voucher optimistic line distinct from ordinary units of the same product', () => {
  const added = sharedCartReducer(linked(), {
    type: 'command/enqueue',
    generation: 1,
    entry: {
      operationId: 'voucher-add',
      intent: {
        kind: 'add',
        product: product(),
        quantity: 1,
        tempId: 'prize',
        attachments: { voucherToken: 'token' },
      },
    },
  });
  expect(added.display).toHaveLength(2);
  const queued = sharedCartReducer(added, {
    type: 'command/enqueue',
    generation: 1,
    entry: {
      operationId: 'coverage',
      intent: {
        kind: 'set_assurance',
        hasAssurance: true,
        target: { kind: 'temp', tempId: 'prize' },
      },
    },
  });
  const settled = sharedCartReducer(queued, {
    type: 'command/reconciled',
    generation: 1,
    operationId: 'voucher-add',
    snapshot: snapshot({
      version: 4,
      lines: [
        cartLine(),
        cartLine({ id: 'prize-line', voucherToken: 'token' }),
      ],
    }),
  });
  expect(settled.queue[0].intent).toMatchObject({
    target: { kind: 'lineId', lineId: 'prize-line' },
  });
});
it('changes assurance only on its attachment-distinct target line', () => {
  const state = linked(3, [
    cartLine(),
    cartLine({ id: 'prize', voucherToken: 'voucher' }),
  ]);
  const queued = sharedCartReducer(state, {
    type: 'command/enqueue',
    generation: 1,
    entry: {
      operationId: 'coverage',
      intent: {
        kind: 'set_assurance',
        hasAssurance: true,
        target: { kind: 'lineId', lineId: 'prize' },
      },
    },
  });
  expect(queued.display.map((line) => line.hasAssurance)).toEqual([
    false,
    true,
  ]);
});
