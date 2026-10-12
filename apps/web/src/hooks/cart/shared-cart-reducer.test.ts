import {
  type CartLine,
  type CartSnapshot,
  cartLineIdentity,
} from '@baci/shared/cart';
import { describe, expect, it } from 'vitest';
import type { Product } from '@/lib/products';
import type { AddToCartOptions, CartItem } from './cart-types';
import {
  cartItemToIdentity,
  deriveSyncStatus,
  displayLineToInputLine,
  initialSharedCartState,
  planLegacyImport,
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

describe('shared-cart-reducer link', () => {
  it('seeds the display from the legacy cache before adopting', () => {
    const cached = [cartItem({ id: 'cached-1', name: 'Cached' })];
    const state = sharedCartReducer(initialSharedCartState, {
      cached,
      generation: 1,
      merchantId: MERCHANT_ID,
      products: {},
      type: 'link/start',
    });

    expect(state.display.map((line) => line.id)).toEqual(['cached-1']);
    expect(state.cartId).toBeNull();
    expect(state.confirmed).toBeNull();
    expect(deriveSyncStatus(state)).toBe('synced');
  });

  it('adopts the server snapshot and converts minor units at the boundary', () => {
    const state = sharedCartReducer(linked(), {
      generation: 1,
      snapshot: snapshot({
        lines: [
          cartLine({
            id: 'line-9',
            lineTotalMinor: 30000,
            quantity: 2,
            unitPriceMinor: 15000,
          }),
        ],
        version: 4,
      }),
      type: 'link/snapshot',
    });

    expect(state.cartId).toBe(CART_ID);
    expect(state.confirmed?.version).toBe(4);
    expect(state.display).toHaveLength(1);
    expect(state.display[0]).toMatchObject({
      id: 'prod-1',
      price: 150,
      quantity: 2,
      serverLineId: 'line-9',
    });
    expect(deriveSyncStatus(state)).toBe('synced');
  });

  it('refuses snapshots from another merchant', () => {
    const state = sharedCartReducer(linked(), {
      generation: 1,
      snapshot: snapshot({
        merchantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        version: 9,
      }),
      type: 'link/snapshot',
    });

    expect(state.confirmed?.version).toBe(3);
    expect(state.cartId).toBe(CART_ID);
  });

  it('resets everything on a session generation change', () => {
    const before = sharedCartReducer(linked(), {
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
    expect(before.display).toHaveLength(2);

    const state = sharedCartReducer(before, {
      generation: 2,
      merchantId: MERCHANT_ID,
      type: 'session/reset',
    });

    expect(state.generation).toBe(2);
    expect(state.display).toEqual([]);
    expect(state.queue).toEqual([]);
    expect(state.confirmed).toBeNull();
    expect(state.cartId).toBeNull();
  });

  it('ignores every action from a stale generation', () => {
    const state = linked();
    const stale = [
      {
        generation: 0,
        snapshot: snapshot({ version: 9 }),
        type: 'link/snapshot',
      },
      {
        entry: {
          intent: {
            kind: 'add',
            product: product(),
            quantity: 1,
            tempId: 'temp-x',
          },
          operationId: 'op-x',
        },
        generation: 0,
        type: 'command/enqueue',
      },
      {
        generation: 0,
        operationId: 'op-x',
        snapshot: snapshot({ version: 9 }),
        type: 'command/reconciled',
      },
      {
        generation: 0,
        snapshot: snapshot({ version: 9 }),
        type: 'snapshot/polled',
      },
    ] as const;

    for (const action of stale) {
      const next = sharedCartReducer(state, action);
      expect(next).toBe(state);
    }
  });
});

describe('shared-cart-reducer optimistic commands', () => {
  it('appends a temp line immediately on add', () => {
    const state = sharedCartReducer(linked(3, []), {
      entry: {
        intent: {
          kind: 'add',
          options: { variantId: 'var-1' } as AddToCartOptions,
          product: product({ id: 'prod-9', name: 'Camera', price: 250 }),
          quantity: 2,
          tempId: 'temp-1',
        },
        operationId: 'op-1',
      },
      generation: 1,
      type: 'command/enqueue',
    });

    expect(state.display).toHaveLength(1);
    expect(state.display[0]).toMatchObject({
      id: 'prod-9',
      name: 'Camera',
      pendingTempId: 'temp-1',
      price: 250,
      quantity: 2,
      serverLineId: null,
      variantId: 'var-1',
    });
    expect(state.display[0].cartItemId).toBe('temp:temp-1');
    expect(state.queue).toHaveLength(1);
    expect(deriveSyncStatus(state)).toBe('pending');
  });

  it('merges an optimistic add onto the matching confirmed line', () => {
    const state = sharedCartReducer(linked(), {
      entry: {
        intent: {
          kind: 'add',
          product: product(),
          quantity: 2,
          tempId: 'temp-1',
        },
        operationId: 'op-1',
      },
      generation: 1,
      type: 'command/enqueue',
    });

    expect(state.display).toHaveLength(1);
    expect(state.display[0]).toMatchObject({
      pendingTempId: 'temp-1',
      quantity: 3,
      serverLineId: 'line-1',
    });
  });

  it('applies set_quantity and remove to temp and confirmed lines', () => {
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
    const updated = sharedCartReducer(added, {
      entry: {
        intent: {
          kind: 'set_quantity',
          quantity: 4,
          target: { kind: 'temp', tempId: 'temp-1' },
        },
        operationId: 'op-2',
      },
      generation: 1,
      type: 'command/enqueue',
    });
    expect(updated.display[0].quantity).toBe(4);

    const removed = sharedCartReducer(updated, {
      entry: {
        intent: {
          kind: 'remove',
          target: { kind: 'temp', tempId: 'temp-1' },
        },
        operationId: 'op-3',
      },
      generation: 1,
      type: 'command/enqueue',
    });
    expect(removed.display).toHaveLength(0);
    // All three intents stay queued until the server confirms each step.
    expect(removed.queue.map((entry) => entry.operationId)).toEqual([
      'op-1',
      'op-2',
      'op-3',
    ]);
  });

  it('leaves pendingTempId alone on set_quantity so repeat edits never block', () => {
    const edited = sharedCartReducer(linked(), {
      entry: {
        intent: {
          kind: 'set_quantity',
          quantity: 4,
          target: { kind: 'lineId', lineId: 'line-1' },
        },
        operationId: 'op-1',
      },
      generation: 1,
      type: 'command/enqueue',
    });

    expect(edited.display[0]).toMatchObject({
      pendingTempId: null,
      quantity: 4,
      serverLineId: 'line-1',
    });
    // A temp claim here would make the next edit target a temp id that
    // only an add reconcile resolves, stalling the queue behind it; the
    // hook test below pins the end-to-end double-edit flow.
  });

  it('clears the display optimistically while keeping the queue ordered', () => {
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
    const cleared = sharedCartReducer(added, {
      entry: {
        intent: { kind: 'clear' },
        operationId: 'op-2',
      },
      generation: 1,
      type: 'command/enqueue',
    });
    expect(cleared.display).toHaveLength(0);

    // A later add still applies on top of the pending clear.
    const readded = sharedCartReducer(cleared, {
      entry: {
        intent: {
          kind: 'add',
          product: product({ id: 'prod-8' }),
          quantity: 1,
          tempId: 'temp-2',
        },
        operationId: 'op-3',
      },
      generation: 1,
      type: 'command/enqueue',
    });
    expect(readded.display.map((line) => line.id)).toEqual(['prod-8']);
  });

  it('marks the sending entry without changing the display', () => {
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
    const sending = sharedCartReducer(added, {
      generation: 1,
      operationId: 'op-1',
      type: 'command/sending',
    });

    expect(sending.queue[0].state).toBe('sending');
    expect(sending.display).toEqual(added.display);
  });
});

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

describe('shared-cart-reducer poll and hydration', () => {
  it('adopts newer polled snapshots and re-applies pending intents', () => {
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
      snapshot: snapshot({
        lines: [
          cartLine(),
          cartLine({
            id: 'line-foreign',
            item: { productId: 'prod-foreign' },
          }),
        ],
        version: 5,
      }),
      type: 'snapshot/polled',
    });

    expect(state.confirmed?.version).toBe(5);
    expect(state.display.map((line) => line.id)).toEqual([
      'prod-1',
      'prod-foreign',
      'prod-9',
    ]);
  });

  it('rejects lower-version polled snapshots within a generation', () => {
    const state = sharedCartReducer(linked(5), {
      generation: 1,
      snapshot: snapshot({ version: 4 }),
      type: 'snapshot/polled',
    });

    expect(state.confirmed?.version).toBe(5);
  });

  it('fills shell lines when their products hydrate', () => {
    const shell = sharedCartReducer(linked(), {
      generation: 1,
      snapshot: snapshot({
        lines: [
          cartLine({
            id: 'line-foreign',
            item: { productId: 'prod-foreign' },
            lineTotalMinor: 5000,
            quantity: 1,
            unitPriceMinor: 5000,
          }),
        ],
        version: 4,
      }),
      type: 'link/snapshot',
    });
    expect(shell.display[0].hydrationFailed).toBe(true);

    const state = sharedCartReducer(shell, {
      generation: 1,
      products: {
        [cartLineIdentity({ productId: 'prod-foreign' })]: product({
          id: 'prod-foreign',
          name: 'Charger',
        }),
      },
      type: 'products/hydrated',
    });

    expect(state.display[0]).toMatchObject({
      hydrationFailed: undefined,
      name: 'Charger',
      price: 50,
    });
  });
});

describe('shared-cart-reducer confirmed display hygiene', () => {
  it('resets negotiated fields the server snapshot does not carry', () => {
    const cached = [
      cartItem({
        assuranceRate: 0.09,
        hasAssurance: true,
        id: 'prod-1',
        negotiatedPrice: 80,
        negotiationStatus: 'accepted',
      }),
    ];
    const started = sharedCartReducer(initialSharedCartState, {
      cached,
      generation: 1,
      merchantId: MERCHANT_ID,
      products: {
        // The hook seeds product shells from the cache itself, so stale
        // negotiated fields ride along unless adoption resets them.
        [cartLineIdentity({ productId: 'prod-1' })]:
          cached[0] as unknown as Product,
      },
      type: 'link/start',
    });
    const state = sharedCartReducer(started, {
      generation: 1,
      snapshot: snapshot({ version: 4 }),
      type: 'link/snapshot',
    });

    expect(state.display[0]).toMatchObject({
      assuranceRate: undefined,
      hasAssurance: false,
      negotiatedPrice: undefined,
      negotiationStatus: 'none',
    });
  });

  it('shows reprice attachments on the optimistic replacement line', () => {
    const added = sharedCartReducer(linked(), {
      entry: {
        intent: {
          kind: 'add',
          attachments: {
            negotiatedUnitPriceMinor: 7500,
            negotiationStatus: 'accepted',
          },
          product: product({ id: 'prod-9', price: 100 }),
          quantity: 1,
          tempId: 'temp-1',
        },
        operationId: 'op-1',
      },
      generation: 1,
      type: 'command/enqueue',
    });

    expect(added.display[1]).toMatchObject({
      negotiatedPrice: 75,
      negotiationStatus: 'accepted',
      pendingTempId: 'temp-1',
    });
  });

  it('targets cached lines by identity before the server knows them', () => {
    const cached = [cartItem({ id: 'prod-9', quantity: 2 })];
    const started = sharedCartReducer(initialSharedCartState, {
      cached,
      generation: 1,
      merchantId: MERCHANT_ID,
      products: {},
      type: 'link/start',
    });
    const key = cartLineIdentity({ productId: 'prod-9' });
    const updated = sharedCartReducer(started, {
      entry: {
        intent: {
          kind: 'set_quantity',
          quantity: 5,
          target: { kind: 'identity', key },
        },
        operationId: 'op-1',
      },
      generation: 1,
      type: 'command/enqueue',
    });
    expect(updated.display[0].quantity).toBe(5);

    const removed = sharedCartReducer(updated, {
      entry: {
        intent: { kind: 'remove', target: { kind: 'identity', key } },
        operationId: 'op-2',
      },
      generation: 1,
      type: 'command/enqueue',
    });
    expect(removed.display).toHaveLength(0);
  });
});

describe('shared-cart-reducer import', () => {
  it('tracks the legacy import lifecycle without touching the queue', () => {
    const started = sharedCartReducer(linked(3, []), {
      generation: 1,
      type: 'import/started',
      warnings: ['too_many_lines'],
    });
    expect(started.importStatus).toBe('pending');
    expect(started.importWarnings).toEqual(['too_many_lines']);

    const finished = sharedCartReducer(started, {
      generation: 1,
      lineCount: 2,
      snapshot: snapshot({ version: 4 }),
      type: 'import/finished',
    });
    expect(finished.importStatus).toBe('done');
    expect(finished.confirmed?.version).toBe(4);
    expect(finished.queue).toHaveLength(0);
  });

  it('stashes merge conflicts for explicit resolution instead of applying', () => {
    const started = sharedCartReducer(linked(), {
      generation: 1,
      type: 'import/started',
    });
    const state = sharedCartReducer(started, {
      conflicts: [
        {
          existing: { quantity: 1 },
          incoming: { quantity: 1, voucherToken: 'v-token' },
          item: { productId: 'prod-1' },
        },
      ],
      generation: 1,
      type: 'import/conflicts',
    });

    expect(state.importStatus).toBe('failed');
    expect(state.importConflicts).toHaveLength(1);
    // The server cart stays authoritative; nothing local is applied.
    expect(state.display.map((line) => line.id)).toEqual(['prod-1']);
  });

  it('records import failures with the error code', () => {
    const started = sharedCartReducer(linked(3, []), {
      generation: 1,
      type: 'import/started',
    });
    const state = sharedCartReducer(started, {
      code: 'temporarily_unavailable',
      generation: 1,
      type: 'import/failed',
    });

    expect(state.importStatus).toBe('failed');
    expect(state.syncError).toBe('temporarily_unavailable');
  });

  it('drops the unimported cache from display when the import fails', () => {
    const started = sharedCartReducer(initialSharedCartState, {
      cached: [cartItem({ id: 'prod-9' })],
      generation: 1,
      merchantId: MERCHANT_ID,
      products: {},
      type: 'link/start',
    });
    expect(started.display).toHaveLength(1);

    const state = sharedCartReducer(
      sharedCartReducer(started, {
        generation: 1,
        snapshot: snapshot({ lines: [], version: 1 }),
        type: 'link/snapshot',
      }),
      { code: 'invalid_item', generation: 1, type: 'import/failed' }
    );

    expect(state.display).toHaveLength(0);
    expect(state.unimportedCache).toHaveLength(0);
  });

  it('keeps unimported lines visible without duplicating overlaps', () => {
    const started = sharedCartReducer(initialSharedCartState, {
      cached: [
        cartItem({ id: 'prod-1', quantity: 3 }),
        cartItem({ id: 'prod-9', quantity: 1 }),
      ],
      generation: 1,
      merchantId: MERCHANT_ID,
      products: {},
      type: 'link/start',
    });
    const state = sharedCartReducer(started, {
      generation: 1,
      snapshot: snapshot({ version: 4 }),
      type: 'link/snapshot',
    });

    // prod-1 defers to the confirmed line; prod-9 stays until imported.
    expect(state.display.map((line) => line.id)).toEqual(['prod-1', 'prod-9']);
    expect(state.display[0].quantity).toBe(1);
  });

  it('enqueues the silent import block at the head in plan order', () => {
    const added = sharedCartReducer(linked(), {
      entry: {
        intent: {
          kind: 'add',
          product: product({ id: 'prod-user' }),
          quantity: 1,
          tempId: 'temp-user',
        },
        operationId: 'op-user',
      },
      generation: 1,
      type: 'command/enqueue',
    });
    const state = sharedCartReducer(added, {
      entries: [
        {
          intent: {
            kind: 'add',
            product: product({ id: 'prod-9' }),
            quantity: 1,
            tempId: 'temp-import-1',
          },
          operationId: 'op-import-1',
        },
        {
          intent: {
            kind: 'set_quantity',
            quantity: 3,
            target: { kind: 'lineId', lineId: 'line-1' },
          },
          operationId: 'op-import-2',
        },
      ],
      generation: 1,
      type: 'import/enqueue',
    });

    expect(state.queue.map((entry) => entry.operationId)).toEqual([
      'op-import-1',
      'op-import-2',
      'op-user',
    ]);
    expect(state.queue[0].silent).toBe(true);
    // Silent intents never touch the display: the user line is the only
    // optimistic change on top of the confirmed snapshot.
    expect(state.display.map((line) => line.id)).toEqual([
      'prod-1',
      'prod-user',
    ]);
  });

  it('resolves already-imported and empty links without adopting', () => {
    const done = sharedCartReducer(linked(), {
      generation: 1,
      status: 'done',
      type: 'import/resolved',
    });
    expect(done.importStatus).toBe('done');

    const skipped = sharedCartReducer(linked(), {
      generation: 1,
      status: 'skipped',
      type: 'import/resolved',
    });
    expect(skipped.importStatus).toBe('skipped');
  });
});

describe('shared-cart-reducer assurance overlay', () => {
  it('toggles assurance display-locally until the server learns it', () => {
    const toggled = sharedCartReducer(linked(), {
      generation: 1,
      hasAssurance: true,
      lineKey: cartLineIdentity({ productId: 'prod-1' }),
      type: 'assurance/overlay',
    });
    expect(toggled.display[0].hasAssurance).toBe(true);

    // The overlay survives reconciliation: the server snapshot has no
    // assurance input, so the display re-applies the shopper's choice.
    const reconciled = sharedCartReducer(toggled, {
      generation: 1,
      operationId: 'op-missing',
      snapshot: snapshot({ version: 4 }),
      type: 'command/reconciled',
    });
    expect(reconciled.display[0].hasAssurance).toBe(true);
  });
});

describe('shared-cart identity mappers', () => {
  it('folds color and storage into the server identity options', () => {
    expect(
      cartItemToIdentity(
        cartItem({
          condition: 'new',
          id: 'prod-1',
          selectedColor: 'Black',
          selectedStorage: '256GB',
          variantAttributes: { storage: '256GB' },
          variantId: 'var-1',
        })
      )
    ).toEqual({
      condition: 'new',
      options: {
        color: 'Black',
        storage: '256GB',
      },
      productId: 'prod-1',
      variantId: 'var-1',
    });
  });

  it('converts display lines to input lines with minor-unit attachments', () => {
    expect(
      displayLineToInputLine(
        cartItem({
          condition: 'used',
          id: 'prod-1',
          negotiatedPrice: 89.5,
          negotiationStatus: 'accepted',
          quantity: 2,
          quizAwardId: 'award-1',
          quizVoucherToken: 'token-1',
          variantId: 'var-1',
        })
      )
    ).toEqual({
      item: {
        condition: 'used',
        productId: 'prod-1',
        variantId: 'var-1',
      },
      negotiatedUnitPriceMinor: 8950,
      negotiationStatus: 'accepted',
      // Voucher lines pin to quantity 1, mirroring the server rule.
      quantity: 1,
      voucherAwardId: 'award-1',
      voucherToken: 'token-1',
    });
  });

  it('drops unsettled negotiation states from the input line', () => {
    const line = displayLineToInputLine(
      cartItem({ negotiationStatus: 'pending', quantity: 1 })
    );
    expect(line.negotiationStatus).toBe('pending');
    expect(line.negotiatedUnitPriceMinor).toBeUndefined();

    const none = displayLineToInputLine(
      cartItem({ negotiationStatus: 'none', quantity: 1 })
    );
    expect(none.negotiationStatus).toBeUndefined();
  });
});

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

  it('truncates beyond the line cap with an explicit warning', () => {
    const local = Array.from({ length: 25 }, (_, index) =>
      cartItem({ id: `prod-${index}`, quantity: 1 })
    );
    const planned = planLegacyImport(local, null, null);

    expect(planned).toMatchObject({ kind: 'create' });
    if (planned.kind !== 'create') throw new Error('expected create plan');
    expect(planned.lines).toHaveLength(20);
    expect(planned.warnings).toEqual(['too_many_lines']);
  });
});
