import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { buildFramedAnchorInterceptorSnippet } from './framed-anchor-snippet';

describe('framed-anchor-snippet', () => {
  it('routes same-tab clicks to navigation.go, _blank/auxclick to navigation.open, and /checkout to checkout.open', () => {
    const rootHandlers = new Map<string, (ev: unknown) => void>();
    const goCalls: string[] = [];
    const openCalls: string[] = [];
    let checkoutOpened = 0;
    const rootEl = {
      addEventListener: (t: string, cb: (ev: unknown) => void) => {
        rootHandlers.set(t, cb);
      },
    };
    const ctx: Record<string, unknown> = {
      TRUSTED_HOST_ORIGIN: 'https://shop.ogabassey.com',
      window: { parent: {}, addEventListener: () => {} },
      document: rootEl,
      URL,
      WeakSet,
      Promise,
    };
    vm.runInNewContext(
      `${buildFramedAnchorInterceptorSnippet()}\nglobalThis.attach = attachFramedNavigationInterceptors;`,
      ctx
    );
    (
      ctx.attach as (
        c: unknown,
        com: unknown,
        init: unknown,
        getP: () => string
      ) => void
    )(
      rootEl,
      {
        navigation: {
          go: (p: string) => {
            goCalls.push(p);
            return { status: 'ok' };
          },
          open: (p: string) => {
            openCalls.push(p);
            return { status: 'ok', value: { presented: true } };
          },
        },
        checkout: {
          open: () => {
            checkoutOpened += 1;
          },
        },
      },
      { merchantSlug: 'ogabassey', pathname: '/' },
      () => '/'
    );

    const makeAnchor = (href: string, target = '') => ({
      tagName: 'A',
      hasAttribute: (k: string) =>
        k === 'target' ? target !== '' : k === 'href',
      getAttribute: (k: string) => (k === 'target' ? target : href),
      parentElement: rootEl,
    });

    rootHandlers.get('click')?.({
      type: 'click',
      button: 0,
      target: makeAnchor('/collections/phones?brand=Apple'),
      preventDefault: () => {},
    });
    rootHandlers.get('click')?.({
      type: 'click',
      button: 0,
      target: makeAnchor('/products/iphone-16?variant=blue#specs', '_blank'),
      preventDefault: () => {},
    });
    rootHandlers.get('click')?.({
      type: 'click',
      button: 0,
      target: makeAnchor('/checkout'),
      preventDefault: () => {},
    });

    expect(goCalls).toEqual(['/collections/phones?brand=Apple']);
    expect(openCalls).toEqual(['/products/iphone-16?variant=blue#specs']);
    expect(checkoutOpened).toBe(1);
  });
});
