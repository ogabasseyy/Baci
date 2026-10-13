import type { Page } from '@playwright/test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cartItem, contact } from './fixtures';
import { seedCheckout } from './setup';

type InitArgs = {
  item: typeof cartItem;
  details: typeof contact & { customerEmail: string };
  emptyCart: boolean;
  startAtContact: boolean;
};

function createPage() {
  let initScript: ((args: InitArgs) => void) | undefined;
  let initArgs: InitArgs | undefined;
  const addInitScript = vi.fn(
    async (script: (args: InitArgs) => void, args: InitArgs) => {
      initScript = script;
      initArgs = args;
    }
  );
  const route = vi.fn();
  const page = { addInitScript, route } as unknown as Page;

  return {
    page,
    route,
    runInitScript() {
      if (!initScript || !initArgs)
        throw new Error('Checkout initialization script was not registered');
      initScript(initArgs);
    },
  };
}

describe('seedCheckout', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('seeds a custom contact-first empty cart and authenticated session route', async () => {
    const { page, route, runInitScript } = createPage();
    await seedCheckout(page, {
      authenticated: true,
      customerEmail: 'reviewer@example.test',
      emptyCart: true,
      startAtContact: true,
    });
    runInitScript();

    expect(
      JSON.parse(localStorage.getItem('baci-cart-ogabassey-guest') ?? 'null')
    ).toEqual([]);
    expect(
      JSON.parse(sessionStorage.getItem('checkout-form') ?? 'null')
    ).toMatchObject({
      customerEmail: 'reviewer@example.test',
      currentStep: 'contact',
      completedSteps: { contact: false, delivery: false },
      deliveryMethod: 'door',
    });
    expect(route).toHaveBeenCalledWith(
      '**/api/storefront/auth/session?**',
      expect.any(Function)
    );
  });

  it('seeds defaults and preserves existing session storage on repeated initialization', async () => {
    const { page, runInitScript } = createPage();
    await seedCheckout(page);
    runInitScript();

    expect(
      JSON.parse(localStorage.getItem('baci-cart-ogabassey-guest') ?? 'null')
    ).toEqual([cartItem]);
    expect(
      JSON.parse(sessionStorage.getItem('checkout-form') ?? 'null')
    ).toMatchObject({
      ...contact,
      currentStep: 'payment',
      completedSteps: { contact: true, delivery: true },
      deliveryMethod: 'pickup',
    });

    localStorage.setItem('baci-cart-ogabassey-guest', '[{"id":"existing"}]');
    sessionStorage.setItem('checkout-form', '{"firstName":"Existing"}');
    runInitScript();

    expect(localStorage.getItem('baci-cart-ogabassey-guest')).toBe(
      '[{"id":"existing"}]'
    );
    expect(sessionStorage.getItem('checkout-form')).toBe(
      '{"firstName":"Existing"}'
    );
  });
});
