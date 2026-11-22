import { renderToString } from 'react-dom/server';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCart } from '@/hooks/cart';
import { fetchAndAddCartItems } from '@/lib/cart-link-transfer';
import { reloadCartHandoffDocument } from '../../cart/cart-handoff-support';
import { CartPageWrapper } from './cart-page-wrapper';

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(),
}));

vi.mock('@/hooks/cart', () => ({
  useCart: vi.fn(),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('./cart-page', () => ({
  CartPage: () => <div>Cart page</div>,
}));

vi.mock('../../cart/cart-handoff', () => ({
  CartHandoff: (props: { token: string; handoffId: string }) => (
    <div>
      Handoff continuation for {props.handoffId} with {props.token}
    </div>
  ),
}));

vi.mock('../../cart/cart-handoff-support', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../cart/cart-handoff-support')>()),
  reloadCartHandoffDocument: vi.fn(),
}));

vi.mock('@/lib/cart-link-transfer', () => ({
  fetchAndAddCartItems: vi.fn(async () => true),
}));

const { useSearchParams } = await import('next/navigation');

function mockSearch(params: string): void {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams(params) as ReturnType<typeof useSearchParams>
  );
}

function mockCartReady(): void {
  vi.mocked(useCart).mockReturnValue({
    addToCart: vi.fn(),
    cart: [],
    isHydrated: true,
  } as unknown as ReturnType<typeof useCart>);
}

describe('CartPageWrapper handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockCartReady();
  });

  it('mounts the handoff continuation when the fragment carries a pairing', async () => {
    mockSearch('');
    window.history.pushState(
      {},
      '',
      '/ogabassey/cart#handoff=ch1.abc%2Fdef&hid=e9644462-bc4a-4efc-80ca-19b89fd47b84'
    );

    render(<CartPageWrapper merchantId="merchant-1" />);

    expect(
      await screen.findByText(
        'Handoff continuation for e9644462-bc4a-4efc-80ca-19b89fd47b84 with ch1.abc/def'
      )
    ).toBeInTheDocument();
    expect(screen.queryByText('Cart page')).not.toBeInTheDocument();
    expect(reloadCartHandoffDocument).not.toHaveBeenCalled();
  });

  it('processes a handoff opened while the website cart is already mounted', async () => {
    mockSearch('');
    window.history.replaceState({}, '', '/ogabassey/cart');
    render(<CartPageWrapper merchantId="merchant-1" />);
    expect(await screen.findByText('Cart page')).toBeInTheDocument();

    window.history.pushState({}, '', '#main-content');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(reloadCartHandoffDocument).not.toHaveBeenCalled();

    window.history.pushState({}, '', '#handoff=ch1.later&hid=later-link');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(reloadCartHandoffDocument).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe('#handoff=ch1.later&hid=later-link');
  });

  it('reconstructs the handoff from the tab locator after a reload', async () => {
    mockSearch('');
    sessionStorage.clear();
    window.history.pushState({}, '', '/ogabassey/cart');
    sessionStorage.setItem(
      'baci-cart-handoff-active',
      JSON.stringify({ token: 'ch1.saved', handoffId: 'handoff-saved' })
    );

    render(<CartPageWrapper merchantId="merchant-1" />);

    expect(
      await screen.findByText(
        'Handoff continuation for handoff-saved with ch1.saved'
      )
    ).toBeInTheDocument();
  });

  it('redacts the pairing and waits for existing device items to reach the website cart', async () => {
    mockSearch('');
    window.history.pushState({}, '', '/ogabassey/cart#handoff=ch1.pending&hid=link');
    const initial = {
      addToCart: vi.fn(),
      cart: [],
      isHydrated: true,
    } as unknown as ReturnType<typeof useCart>;
    vi.mocked(useCart).mockReturnValue({
      ...initial,
      sharedCartEnabled: true,
      importStatus: 'pending',
    });
    const { rerender } = render(<CartPageWrapper merchantId="merchant-1" />);
    expect(await screen.findByText('Loading your cart…')).toBeInTheDocument();
    expect(window.location.hash).toBe('');
    expect(screen.queryByText(/Handoff continuation/)).not.toBeInTheDocument();

    vi.mocked(useCart).mockReturnValue({
      ...initial,
      sharedCartEnabled: true,
      importStatus: 'done',
    });
    rerender(<CartPageWrapper merchantId="merchant-1" />);
    expect(await screen.findByText(/Handoff continuation for link/)).toBeInTheDocument();
  });

  it('restores a scoped locator on its own merchant cart page', async () => {
    mockSearch('');
    window.history.pushState({}, '', '/shop-a/cart');
    sessionStorage.setItem(
      'baci-cart-handoff-active',
      JSON.stringify({
        token: 'ch1.saved',
        handoffId: 'handoff-saved',
        merchantSlug: 'shop-a',
      })
    );

    render(<CartPageWrapper merchantId="merchant-1" merchantSlug="shop-a" />);

    expect(
      await screen.findByText(
        'Handoff continuation for handoff-saved with ch1.saved'
      )
    ).toBeInTheDocument();
  });

  it('continues an empty hydrated website cart with no device import', async () => {
    mockSearch('');
    window.history.pushState({}, '', '/ogabassey/cart#handoff=ch1.empty&hid=empty-link');
    vi.mocked(useCart).mockReturnValue({
      addToCart: vi.fn(), cart: [], isHydrated: true, sharedCartEnabled: true, importStatus: 'none',
    } as unknown as ReturnType<typeof useCart>);
    render(<CartPageWrapper merchantId="merchant-1" />);
    expect(await screen.findByText(/Handoff continuation for empty-link/)).toBeInTheDocument();
  });

  it("ignores merchant A's scoped locator on merchant B's cart page", async () => {
    mockSearch('');
    window.history.pushState({}, '', '/shop-b/cart');
    sessionStorage.setItem(
      'baci-cart-handoff-active',
      JSON.stringify({
        token: 'ch1.saved',
        handoffId: 'handoff-saved',
        merchantSlug: 'shop-a',
      })
    );

    render(<CartPageWrapper merchantId="merchant-1" merchantSlug="shop-b" />);

    expect(await screen.findByText('Cart page')).toBeInTheDocument();
    expect(screen.queryByText(/Handoff continuation/)).not.toBeInTheDocument();
  });

  it('holds the item transfer while a handoff pairing owns the surface', async () => {
    mockSearch('item_id=55555555-5555-4555-8555-555555555555&qty=2');
    window.history.pushState(
      {},
      '',
      '/ogabassey/cart#handoff=ch1.token&hid=e9644462-bc4a-4efc-80ca-19b89fd47b84'
    );

    render(<CartPageWrapper merchantId="merchant-1" />);

    expect(await screen.findByText(/Handoff continuation/)).toBeInTheDocument();
    await waitFor(() =>
      expect(vi.mocked(fetchAndAddCartItems)).not.toHaveBeenCalled()
    );
  });

  it.each(['#handoff=ch1.token', '#hid=e9644462-bc4a-4efc-80ca-19b89fd47b84', ''])(
    'falls back to the ordinary cart page when the pairing is incomplete (%s)',
    (hash) => {
      mockSearch('');
      window.history.pushState({}, '', `/ogabassey/cart${hash}`);

      render(<CartPageWrapper merchantId="merchant-1" />);

      expect(screen.getByText('Cart page')).toBeInTheDocument();
      expect(screen.queryByText(/Handoff continuation/)).not.toBeInTheDocument();
    }
  );
});

it('renders the ordinary initial tree before the browser handoff effect', () => {
  mockSearch('');
  mockCartReady();
  window.history.replaceState({}, '', '/cart#handoff=secret&hid=public');
  const html = renderToString(<CartPageWrapper merchantId="merchant-1" />);
  expect(html).not.toContain('Handoff continuation');
});
