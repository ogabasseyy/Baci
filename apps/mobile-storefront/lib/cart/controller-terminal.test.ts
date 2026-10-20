import {
  isUnrecoverablePromotion,
  retireTerminalReference,
} from './controller-terminal';

describe('isUnrecoverablePromotion', () => {
  it('flags create, handoff, and account promotions', () => {
    for (const kind of ['create', 'handoff', 'account']) {
      expect(isUnrecoverablePromotion({ body: { kind } } as never)).toBe(true);
    }
  });

  it('ignores other pending requests and empty state', () => {
    expect(isUnrecoverablePromotion(null)).toBe(false);
    expect(
      isUnrecoverablePromotion({ body: { kind: 'command' } } as never)
    ).toBe(false);
    expect(isUnrecoverablePromotion({ body: null } as never)).toBe(false);
  });
});

describe('retireTerminalReference', () => {
  const legacy = {
    items: [{ id: 'line-1' }] as never[],
    sharedCartRef: { cartId: 'cart-1', merchantId: 'm-1' } as never,
  };

  it('retires only the exact terminal cart reference', () => {
    const repair = jest.fn();
    const result = retireTerminalReference(legacy as never, 'cart-1', repair);
    expect(repair).toHaveBeenCalledWith(legacy.items);
    expect(result.sharedCartRef).toBeUndefined();
    expect(result.items).toBe(legacy.items);
  });

  it('leaves a live different-cart reference untouched', () => {
    const repair = jest.fn();
    const result = retireTerminalReference(legacy as never, 'cart-2', repair);
    expect(repair).not.toHaveBeenCalled();
    expect(result).toBe(legacy);
  });

  it('is a no-op without a repair callback or terminal id', () => {
    expect(retireTerminalReference(legacy as never, null, jest.fn())).toBe(
      legacy
    );
    expect(retireTerminalReference(legacy as never, 'cart-1')).toBe(legacy);
  });
});
