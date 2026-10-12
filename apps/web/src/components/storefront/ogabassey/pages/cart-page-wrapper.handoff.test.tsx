import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCart } from '@/hooks/cart';
import { fetchAndAddCartItems } from '@/lib/cart-link-transfer';
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
