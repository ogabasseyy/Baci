import type { CartItem } from '@/stores/cart-store.types';
import { createNativeCartController } from './controller';
import { NativeCartError } from './native-cart-error';

export const merchant = '11111111-1111-4111-8111-111111111111';
export const cartId = '22222222-2222-4222-8222-222222222222';
export const PRODUCT_A = '33333333-3333-4333-8333-333333333333';
export const PRODUCT_B = '44444444-4444-4444-8444-444444444444';

interface ServerLine {
  id: string;
  productId: string;
  quantity: number;
}
export function snapshotOf(
  version: number,
  lines: ServerLine[],
  state = 'active'
) {
  return {
    merchantId: merchant,
    cartId,
    version,
    state,
    currency: 'NGN',
    lines: lines.map((line) => ({
      id: line.id,
      item: { productId: line.productId },
      quantity: line.quantity,
      unitPriceMinor: 500,
      lineTotalMinor: 500 * line.quantity,
    })),
    subtotalMinor: 0,
    totalMinor: 0,
    estimatedTotals: false,
    expiresAt: '2099-01-01T00:00:00Z',
  };
}
export const shopItem = (
  productId: string,
  quantity = 1
): Omit<CartItem, 'id'> => ({
  product_id: productId,
  slug: productId,
  name: productId,
  price: 5,
  quantity,
});

/** A fake server and screen around the real controller, queue and receipts logic. */
export function setup(options: { live?: boolean } = {}) {
  const server = {
    version: 1,
    lines: [] as ServerLine[],
    next: 0,
  };
  const screen = {
    items: [] as CartItem[],
    history: [] as CartItem[][],
    ref: undefined as { merchantId: string; cartId: string } | undefined,
  };
  const show = (items: CartItem[]) => {
    screen.items = items;
    screen.history.push(items);
  };
  let context: { actor: string; cartId: string | null } | null = options.live
    ? { actor: 'guest', cartId }
    : null;
  const calls: string[] = [];
  const gates: Array<() => void> = [];
  const failures: Array<NativeCartError | null> = [];
  let hold = false;
  let retainReceipt = false;
  const retained = { armed: false };
  const apply = (command: Record<string, unknown>) => {
    if (command.type === 'add') {
      const item = command.item as { productId: string };
      const quantity = command.quantity as number;
      const existing = server.lines.find((l) => l.productId === item.productId);
      if (existing) existing.quantity += quantity;
      else {
        server.next += 1;
        server.lines.push({
          id: `line-${server.next}`,
          productId: item.productId,
          quantity,
        });
      }
    } else if (command.type === 'set_quantity') {
      const line = server.lines.find((l) => l.id === command.lineId);
      if (line) line.quantity = command.quantity as number;
    } else if (command.type === 'remove')
      server.lines = server.lines.filter((l) => l.id !== command.lineId);
    else if (command.type === 'clear') server.lines = [];
    server.version += 1;
  };
  const client = {
    context: jest.fn(() => Promise.resolve(context)),
    bootstrap: jest.fn(() => {
      context = { actor: 'guest', cartId: null };
      return Promise.resolve({ proof: 'cp1.a.sig' });
    }),
    read: jest.fn(() =>
      Promise.resolve({ cart: snapshotOf(server.version, server.lines) })
    ),
    create: jest.fn((input: { lines: { item: unknown }[] }) => {
      calls.push(`create:${input.lines.length}`);
      context = { actor: 'guest', cartId };
      server.lines = input.lines.map((line, index) => ({
        id: `seed-${index}`,
        productId: (line.item as { productId: string }).productId,
        quantity: 1,
      }));
      return Promise.resolve({
        cart: snapshotOf(server.version, server.lines),
      });
    }),
    command: jest.fn(
      async (input: {
        expectedVersion: number;
        command: Record<string, unknown>;
      }) => {
        calls.push(`command:${String(input.command.type)}`);
        if (input.expectedVersion !== server.version)
          throw new NativeCartError('version_conflict');
        if (hold) await new Promise<void>((resolve) => gates.push(resolve));
        const failure = failures.shift();
        if (failure) {
          retained.armed = retainReceipt;
          throw failure;
        }
        apply(input.command);
        return { cart: snapshotOf(server.version, server.lines) };
      }
    ),
    recoverCreation: jest.fn().mockResolvedValue(null),
    restartSession: jest.fn(() => {
      context = { actor: 'guest', cartId: null };
      return Promise.resolve({ proof: 'cp1.b.sig' });
    }),
    prepareCheckout: jest.fn(() => {
      calls.push('checkout');
      return Promise.resolve({ ok: true } as never);
    }),
  };
  const receipts = {
    read: jest.fn(() => {
      const hit = retained.armed;
      if (!retainReceipt) retained.armed = false;
      return Promise.resolve(
        hit ? ({ operationId: 'retained', body: {} } as never) : null
      );
    }),
    save: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
  };
  const failed = jest.fn();
  const succeeded = jest.fn();
  const controller = createNativeCartController({
    merchantId: merchant,
    client: client as never,
    receipts,
    newOperationId: (() => {
      let n = 0;
      return () => `key-${++n}`;
    })(),
    getLegacy: () => ({ items: screen.items, sharedCartRef: screen.ref }),
    repairLegacy: (items) => {
      screen.items = items;
      screen.ref = undefined;
    },
    loadProduct: async (_m, id) => ({ id, slug: id, name: id }),
    publish: (snapshot, display) => {
      screen.ref = { merchantId: snapshot.merchantId, cartId: snapshot.cartId };
      show(display.items);
    },
    showItems: show,
    onWriteFailed: failed,
    onWriteSucceeded: succeeded,
    status: jest.fn(),
    isCurrent: () => true,
  });
  return {
    client,
    controller,
    failed,
    succeeded,
    calls,
    failures,
    receipts,
    screen,
    server,
    retainReceiptOnFailure: () => {
      retainReceipt = true;
    },
    loseProof: () => {
      context = null;
    },
    holdCommands: () => {
      hold = true;
    },
    release: async () => {
      for (const gate of gates.splice(0)) gate();
      await flushAsync();
    },
    /** Lets held commands through, one at a time, until every promise settles. */
    drain: async (...promises: Promise<unknown>[]) => {
      let settled = false;
      void Promise.allSettled(promises).then(() => {
        settled = true;
      });
      for (let i = 0; i < 300 && !settled; i += 1) {
        for (const gate of gates.splice(0)) gate();
        await flushAsync();
      }
    },
    seed: (lines: ServerLine[]) => {
      server.lines = lines;
    },
  };
}
export async function flushAsync() {
  for (let i = 0; i < 60; i += 1) await Promise.resolve();
}
export const quantities = (items: CartItem[]) => items.map((i) => i.quantity);

export function apply(
  s: ReturnType<typeof setup>,
  input: { command: { lineId: string; quantity: number } }
) {
  const line = s.server.lines.find((l) => l.id === input.command.lineId);
  if (line) line.quantity = input.command.quantity;
  s.server.version += 1;
}
