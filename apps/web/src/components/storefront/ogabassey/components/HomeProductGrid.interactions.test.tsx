import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMockInteractionBindingsModule,
  createMockInteractiveCardModule,
  createTestProduct,
  flushPostPaintActivation,
} from './HomeProductGrid.test-utils';

vi.mock('@baci/shared/storefront', () => ({
  prioritizeSmartphoneProducts: vi.fn((products: unknown[]) => products),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    prefetch,
    ...props
  }: {
    children: ReactNode;
    href: string;
    prefetch?: boolean;
  }) => (
    <a data-prefetch={String(prefetch)} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('next/dynamic', () => ({
  default: () => () => null,
}));

vi.mock('./deferred-ad-unit', () => ({
  DeferredAdUnit: ({ fallback }: { fallback?: ReactNode; placementKey: string }) => (
    <div>{fallback}</div>
  ),
}));

vi.mock('./HomeProductGridCard', () => ({
  HomeProductGridCard: ({
    product,
    deferImageLoading,
  }: {
    product: { name: string };
    deferImageLoading?: boolean;
  }) => (
    <article
      data-card-variant="static"
      data-defer-image-loading={String(Boolean(deferImageLoading))}
    >
      {product.name}
    </article>
  ),
}));

vi.mock('./ProductGridItem', () => ({
  ProductGridItem: ({
    product,
    deferImageLoading,
    interactiveChromeTimeoutMs,
    interactiveChromeActivateOnIdle,
  }: {
    product: { name: string };
    deferImageLoading?: boolean;
    interactiveChromeTimeoutMs?: number;
    interactiveChromeActivateOnIdle?: boolean;
  }) => (
    <article
      data-card-variant="interactive"
      data-defer-image-loading={String(Boolean(deferImageLoading))}
      data-interactive-timeout={
        interactiveChromeTimeoutMs === undefined
          ? 'default'
          : String(interactiveChromeTimeoutMs)
      }
      data-interactive-idle={String(
        interactiveChromeActivateOnIdle !== false
      )}
    >
      {product.name}
    </article>
  ),
}));

import { HomeProductGrid } from './HomeProductGrid';

describe('HomeProductGrid interaction/activation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    await act(async () => {
      vi.runOnlyPendingTimers();
      await Promise.resolve();
    });
    vi.useRealTimers();
  });

  it('defers the interactive bindings import until activation', async () => {
    const loadInteractionBindings = vi
      .fn()
      .mockResolvedValue(createMockInteractionBindingsModule());

    render(
      <HomeProductGrid
        products={[createTestProduct(1)]}
        loadInteractionBindings={loadInteractionBindings}
      />
    );

    expect(loadInteractionBindings).not.toHaveBeenCalled();

    fireEvent.pointerDown(screen.getByRole('article'));

    await act(async () => {
      await Promise.resolve();
    });

    expect(loadInteractionBindings).not.toHaveBeenCalled();

    await flushPostPaintActivation();

    expect(loadInteractionBindings).toHaveBeenCalledOnce();
  });

  it('preserves keyboard focus across the static-to-interactive swap (a11y regression)', async () => {
    const loadInteractionBindings = vi
      .fn()
      .mockResolvedValue(createMockInteractionBindingsModule());
    const loadInteractiveCard = vi
      .fn()
      .mockResolvedValue(createMockInteractiveCardModule());

    render(
      <HomeProductGrid
        products={[createTestProduct(1)]}
        loadInteractionBindings={loadInteractionBindings}
        loadInteractiveCard={loadInteractiveCard}
      />
    );

    // A keyboard user tabs into the grid: focus lands on the view-all link,
    // and that focusin is itself the activation trigger for the swap.
    const viewAll = screen.getByRole('link', { name: /view all products/i });
    act(() => {
      viewAll.focus();
    });
    fireEvent.focusIn(viewAll);

    await flushPostPaintActivation();

    // The swap remounts the subtree; focus must land back on the equivalent
    // link instead of being dropped to <body>.
    const viewAllAfterSwap = screen.getByRole('link', {
      name: /view all products/i,
    });
    expect(document.activeElement).toBe(viewAllAfterSwap);
  });

  it('does not load interactive modules on pointer activity outside the grid', async () => {
    const loadInteractionBindings = vi
      .fn()
      .mockResolvedValue(createMockInteractionBindingsModule());

    render(
      <HomeProductGrid
        products={[createTestProduct(1)]}
        loadInteractionBindings={loadInteractionBindings}
      />
    );

    // Pointer activity anywhere outside the grid (hero, nav, page shell) must
    // not pull in the interactive-card graph.
    fireEvent.pointerDown(document.body);
    fireEvent.pointerDown(window);

    await flushPostPaintActivation();

    expect(loadInteractionBindings).not.toHaveBeenCalled();

    fireEvent.pointerDown(screen.getByRole('article'));

    await flushPostPaintActivation();

    expect(loadInteractionBindings).toHaveBeenCalledOnce();
  });

  it('renders lightweight static cards until the interactive modules load', async () => {
    const loadInteractionBindings = vi
      .fn()
      .mockResolvedValue(createMockInteractionBindingsModule());
    const loadInteractiveCard = vi
      .fn()
      .mockResolvedValue(createMockInteractiveCardModule());

    render(
      <HomeProductGrid
        products={[createTestProduct(1)]}
        loadInteractionBindings={loadInteractionBindings}
        loadInteractiveCard={loadInteractiveCard}
      />
    );

    expect(screen.getByRole('article')).toHaveAttribute(
      'data-card-variant',
      'static'
    );
    expect(loadInteractiveCard).not.toHaveBeenCalled();

    fireEvent.pointerDown(screen.getByRole('article'));

    await act(async () => {
      await Promise.resolve();
    });

    expect(loadInteractionBindings).not.toHaveBeenCalled();
    expect(loadInteractiveCard).not.toHaveBeenCalled();
    expect(screen.getByRole('article')).toHaveAttribute(
      'data-card-variant',
      'static'
    );

    await flushPostPaintActivation();

    expect(loadInteractionBindings).toHaveBeenCalledOnce();
    expect(loadInteractiveCard).toHaveBeenCalledOnce();
    expect(screen.getByRole('article')).toHaveAttribute(
      'data-card-variant',
      'interactive'
    );
  });

  it('does not auto-import interactive bindings on a timeout alone', async () => {
    const loadInteractionBindings = vi
      .fn()
      .mockResolvedValue(createMockInteractionBindingsModule());

    render(
      <HomeProductGrid
        products={[createTestProduct(1)]}
        loadInteractionBindings={loadInteractionBindings}
      />
    );

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });

    expect(loadInteractionBindings).not.toHaveBeenCalled();
  });

  it('keeps clean static cards on mobile touch gestures without swapping in overlay chrome', async () => {
    const loadInteractionBindings = vi
      .fn()
      .mockResolvedValue(createMockInteractionBindingsModule());
    const loadInteractiveCard = vi
      .fn()
      .mockResolvedValue(createMockInteractiveCardModule());

    render(
      <HomeProductGrid
        products={[createTestProduct(1)]}
        loadInteractionBindings={loadInteractionBindings}
        loadInteractiveCard={loadInteractiveCard}
      />
    );

    const card = screen.getByRole('article');
    fireEvent.touchStart(card);
    fireEvent.pointerDown(card, { pointerType: 'touch' });
    fireEvent.focusIn(card);
    fireEvent.click(card);

    await flushPostPaintActivation();

    expect(loadInteractionBindings).not.toHaveBeenCalled();
    expect(loadInteractiveCard).not.toHaveBeenCalled();
    expect(screen.getByRole('article')).toHaveAttribute(
      'data-card-variant',
      'static'
    );
  });
});
