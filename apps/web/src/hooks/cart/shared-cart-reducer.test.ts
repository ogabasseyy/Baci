import {
  type CartLine,
  type CartSnapshot,
  cartLineIdentity,
} from '@baci/shared/cart';

import { describe, expect, it } from 'vitest';

import type { Product } from '@/lib/products';

import type { AddToCartOptions, CartItem } from './cart-types';

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
    for (const action of [
      { type: 'import/started', generation: 1 },
      { type: 'import/resolved', generation: 1, status: 'skipped' },
      {
        type: 'import/finished',
        generation: 1,
        lineCount: 1,
        snapshot: snapshot(),
      },
    ] as const) {
      expect(sharedCartReducer(state, action).importConflicts).toEqual([]);
    }
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

it('resolves queued edits when PostgreSQL returns lower-case UUIDs for an upper-case selection', () => {
  const productId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const variantId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  let state = sharedCartReducer(linked(3, []), {
    type: 'command/enqueue',
    generation: 1,
    entry: {
      operationId: 'case-add',
      intent: {
        kind: 'add',
        product: product({ id: productId.toUpperCase() }),
        options: { variantId: variantId.toUpperCase() },
        quantity: 1,
        tempId: 'case-temp',
      },
    },
  });
  state = sharedCartReducer(state, {
    type: 'command/enqueue',
    generation: 1,
    entry: {
      operationId: 'case-edit',
      intent: {
        kind: 'set_quantity',
        target: { kind: 'temp', tempId: 'case-temp' },
        quantity: 2,
      },
    },
  });
  state = sharedCartReducer(state, {
    type: 'command/reconciled',
    generation: 1,
    operationId: 'case-add',
    snapshot: snapshot({
      version: 4,
      lines: [
        cartLine({ id: 'confirmed-case-line', item: { productId, variantId } }),
      ],
    }),
  });
  expect(state.queue).toHaveLength(1);
  expect(state.queue[0].intent).toMatchObject({
    kind: 'set_quantity',
    target: { kind: 'lineId', lineId: 'confirmed-case-line' },
    quantity: 2,
  });
  expect(state.syncError).toBeNull();
  expect(state.display).toHaveLength(1);
  expect(state.display[0]).toMatchObject({
    serverLineId: 'confirmed-case-line',
    quantity: 2,
  });
});
