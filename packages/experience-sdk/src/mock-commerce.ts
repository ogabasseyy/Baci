import type {
  BridgeResult,
  ExperienceCommerce,
  PublicBootstrap,
  PublicCart,
} from '@baci/shared/experience';

const ok = <T>(value: T): Promise<BridgeResult<T>> =>
  Promise.resolve({
    status: 'ok',
    value: structuredClone(value),
  });
const fail = (): Promise<BridgeResult<never>> =>
  Promise.resolve({
    status: 'error',
    code: 'INVALID_REQUEST',
    message: 'Synthetic preview request unavailable.',
  });
/** In-memory synthetic preview only; no fetch, SDK server imports or transaction side effects. */
export function createMockCommerce(
  fixtures: PublicBootstrap
): ExperienceCommerce {
  let route = { ...fixtures.route };
  let counter = 0;
  const cart: PublicCart = {
    lines: [],
    total: 0,
    currency: fixtures.catalog.products[0]?.currency ?? 'USD',
    version: 1,
  };
  const product = (id: string) =>
    fixtures.catalog.products.find((p) => p.id === id || p.slug === id);
  const update = () => {
    cart.total = cart.lines.reduce((n, l) => n + l.price * l.quantity, 0);
    cart.version++;
    return ok(cart);
  };
  const validQuantity = (q: number) => Number.isInteger(q) && q > 0 && q <= 999;
  return {
    catalog: {
      collection: () => ok(fixtures.catalog),
      product: (handle) => {
        const p = product(handle);
        return p ? ok(p) : fail();
      },
      variants: (id) => {
        const p = product(id);
        return p ? ok(p.variants) : fail();
      },
    },
    cart: {
      reconcile: (operationId) =>
        Promise.resolve({ status: 'indeterminate' as const, operationId }),
      readPublic: () => ok(cart),
      add: (input) => {
        const p = product(input.productId);
        if (
          !p ||
          p.currency !== cart.currency ||
          !validQuantity(input.quantity) ||
          (p.variants.length &&
            !p.variants.some((v) => v.id === input.variantId && v.available))
        )
          return fail();
        const line = cart.lines.find(
          (l) => l.productId === p.id && l.variantId === input.variantId
        );
        if (line) {
          if (!validQuantity(line.quantity + input.quantity)) return fail();
          line.quantity += input.quantity;
        } else
          cart.lines.push({
            lineId: `synthetic-${++counter}`,
            productId: p.id,
            variantId: input.variantId,
            quantity: input.quantity,
            price: p.price,
          });
        return update();
      },
      remove: (lineId) => {
        const at = cart.lines.findIndex((l) => l.lineId === lineId);
        if (at < 0) return fail();
        cart.lines.splice(at, 1);
        return update();
      },
      setQuantity: (lineId, quantity) => {
        const line = cart.lines.find((l) => l.lineId === lineId);
        if (!line || !validQuantity(quantity)) return fail();
        line.quantity = quantity;
        return update();
      },
    },
    checkout: {
      prepare: () => ok({ ready: cart.lines.length > 0 }),
      open: () => ok({ presented: false }),
    },
    navigation: {
      go: (path) => {
        if (
          !path.startsWith('/') ||
          path.startsWith('//') ||
          /[\\%:#?]/.test(path) ||
          [...path].some(
            (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127
          ) ||
          path.split('/').some((p) => p === '.' || p === '..')
        )
          return fail();
        route = {
          ...route,
          epoch: route.epoch + 1,
          routeId: path,
          canonicalPath: path,
        };
        return ok(route);
      },
      open: () => ok({ presented: false }),
    },
  };
}
