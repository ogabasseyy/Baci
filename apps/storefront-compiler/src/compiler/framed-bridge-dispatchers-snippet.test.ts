import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { buildFramedBridgeDispatchersSnippet } from './framed-bridge-dispatchers-snippet';

describe('framed-bridge-dispatchers-snippet', () => {
  it('serializes navigation.go with navHooks and preserves conflict/indeterminate cart responses', async () => {
    const calls: Array<{ method: string; args: unknown }> = [];
    const ctx: Record<string, unknown> = {
      hostPort: {},
      hostEpoch: 1,
      hostPending: new Map(),
      CART_MUTATION_METHODS: new Set(['cart.add', 'cart.reconcile']),
      isValidHostRouteState: (v: Record<string, unknown>) =>
        Boolean(v && typeof v.epoch === 'number'),
      sendFramedBridgeRequest: async (method: string, args: unknown) => {
        calls.push({ method, args });
        if (method === 'navigation.go') {
          return {
            status: 'ok',
            value: {
              epoch: 3,
              routeId: 'search',
              params: {},
              canonicalPath: '/search',
              publicDataRevision: '1:1',
            },
          };
        }
        return { status: 'conflict', currentVersion: 4 };
      },
      Date,
      Number,
      Promise,
    };
    vm.runInNewContext(
      `${buildFramedBridgeDispatchersSnippet()}\nglobalThis.nav = dispatchFramedNavigation; globalThis.cart = dispatchFramedCartOrCheckout;`,
      ctx
    );
    const settled: unknown[] = [];
    const navRes = await (
      ctx.nav as (
        m: string,
        p: string,
        ep: number,
        hooks: unknown
      ) => Promise<unknown>
    )('navigation.go', '/search', 1, {
      onSend: () => 'tok-1',
      onSettle: (tok: unknown, res: unknown) => settled.push({ tok, res }),
    });
    expect(navRes).toMatchObject({ status: 'ok' });
    expect(settled).toHaveLength(1);

    const cartRes = await (
      ctx.cart as (m: string, a: unknown, ep: number) => Promise<unknown>
    )('cart.add', { variantId: 'v1', quantity: 1 }, 3);
    expect(cartRes).toEqual({ status: 'conflict', currentVersion: 4 });
    expect(calls).toHaveLength(2);
  });
});
