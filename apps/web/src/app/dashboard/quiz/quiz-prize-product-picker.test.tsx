import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuizPrizeProductPicker } from './quiz-prize-product-picker';

const mockApiGet = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-client', () => ({
  apiGet: (...args: unknown[]) => mockApiGet(...args),
}));

vi.mock('@/components/optimized-image', () => ({
  ThumbnailImage: ({ alt, src }: { alt: string; src: string }) => (
    // biome-ignore lint/performance/noImgElement: deterministic image stub
    <img alt={alt} src={src} />
  ),
}));

const initialProduct = {
  available: true,
  condition: 'new',
  defaultVariantId: null,
  effectiveStock: 8,
  hasVariants: false,
  id: '55555555-5555-4555-8555-555555555555',
  imageUrl: null,
  manageStock: true,
  name: 'iPhone 15 Pro Max',
  price: 2_100_000,
  requiresVariantSelection: false,
  selectionId: '55555555-5555-4555-8555-555555555555:product',
  variantId: null,
  variantLabel: null,
};

const searchedProduct = {
  ...initialProduct,
  condition: 'open_box',
  effectiveStock: 3,
  hasVariants: true,
  id: '66666666-6666-4666-8666-666666666666',
  imageUrl: 'https://cdn.example.com/galaxy-blue.png',
  name: 'Samsung Galaxy S25',
  price: 1_800_000,
  selectionId:
    '66666666-6666-4666-8666-666666666666:77777777-7777-4777-8777-777777777777',
  variantId: '77777777-7777-4777-8777-777777777777',
  variantLabel: '256GB / Blue',
};

describe('QuizPrizeProductPicker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockApiGet.mockReset();
  });

  afterEach(() => vi.useRealTimers());

  it('debounces inventory search and selects an exact variant with the keyboard', async () => {
    mockApiGet.mockResolvedValue({
      nextCursor: null,
      products: [searchedProduct],
      total: 1,
    });
    const onSelect = vi.fn();
    render(
      <QuizPrizeProductPicker
        initialProducts={[initialProduct]}
        onSelect={onSelect}
        selectedProduct={null}
      />
    );
    const input = screen.getByRole('combobox', {
      name: /search prize product inventory/i,
    });

    fireEvent.change(input, { target: { value: 'Galaxy' } });
    expect(mockApiGet).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
      await Promise.resolve();
    });
    expect(mockApiGet).toHaveBeenCalledOnce();
    expect(mockApiGet).toHaveBeenCalledWith(
      '/api/merchant/quiz/prize-products?limit=12&search=Galaxy',
      { signal: expect.any(AbortSignal) }
    );

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(searchedProduct);
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('aborts stale searches when the query changes', async () => {
    mockApiGet.mockReturnValue(new Promise(() => undefined));
    render(
      <QuizPrizeProductPicker
        initialProducts={[initialProduct]}
        onSelect={vi.fn()}
        selectedProduct={null}
      />
    );
    const input = screen.getByRole('combobox');

    fireEvent.change(input, { target: { value: 'Gal' } });
    await act(() => vi.advanceTimersByTimeAsync(250));
    const firstSignal = mockApiGet.mock.calls[0]?.[1]?.signal as AbortSignal;
    fireEvent.change(input, { target: { value: 'Galaxy' } });

    expect(firstSignal.aborted).toBe(true);
  });

  it('shows loading, empty, and error states', async () => {
    let resolveSearch: ((value: unknown) => void) | undefined;
    mockApiGet.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSearch = resolve;
      })
    );
    render(
      <QuizPrizeProductPicker
        initialProducts={[]}
        onSelect={vi.fn()}
        selectedProduct={null}
      />
    );
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'Missing' } });
    await act(() => vi.advanceTimersByTimeAsync(250));
    expect(screen.getByText('Searching inventory…')).toBeInTheDocument();
    await act(async () => {
      resolveSearch?.({ nextCursor: null, products: [], total: 0 });
      await Promise.resolve();
    });
    expect(
      screen.getByText('No matching active products.')
    ).toBeInTheDocument();

    mockApiGet.mockRejectedValueOnce(new Error('Inventory unavailable'));
    fireEvent.change(input, { target: { value: 'Another' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
      await Promise.resolve();
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Inventory unavailable'
    );
  });

  it('paginates beyond the initial inventory page', async () => {
    vi.useRealTimers();
    mockApiGet.mockResolvedValue({
      nextCursor: null,
      products: [searchedProduct],
      total: 101,
    });
    const user = userEvent.setup();
    render(
      <QuizPrizeProductPicker
        initialNextCursor="12"
        initialProducts={[initialProduct]}
        onSelect={vi.fn()}
        selectedProduct={null}
      />
    );
    await user.click(screen.getByRole('combobox'));
    await user.click(
      screen.getByRole('button', { name: 'Load more inventory' })
    );

    expect(mockApiGet).toHaveBeenCalledWith(
      '/api/merchant/quiz/prize-products?cursor=12&limit=12',
      { signal: expect.any(AbortSignal) }
    );
    expect(
      await screen.findByRole('option', { name: /Samsung Galaxy S25/i })
    ).toBeInTheDocument();
  });

  it('keeps the result list overlaid so it does not resize the form grid', async () => {
    render(
      <QuizPrizeProductPicker
        initialProducts={[initialProduct]}
        onSelect={vi.fn()}
        selectedProduct={null}
      />
    );

    fireEvent.focus(screen.getByRole('combobox'));

    expect(screen.getByRole('listbox')).toHaveClass('absolute', 'z-50');
  });
});
