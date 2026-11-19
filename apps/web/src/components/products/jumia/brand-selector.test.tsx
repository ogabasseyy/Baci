import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Store the onOpenChange callback so trigger can call it
let popoverOnOpenChange: ((open: boolean) => void) | undefined;

vi.mock('@/components/ui/popover', () => ({
  Popover: ({
    children,
    open,
    onOpenChange,
  }: {
    children: ReactNode;
    open: boolean;
    onOpenChange: (o: boolean) => void;
  }) => {
    popoverOnOpenChange = onOpenChange;
    return (
      <div data-testid="popover" data-open={String(open)}>
        {children}
      </div>
    );
  },
  PopoverTrigger: ({
    children,
  }: {
    children: ReactNode;
    asChild?: boolean;
  }) => (
    <button
      type="button"
      onClick={() => popoverOnOpenChange?.(true)}
      onKeyDown={() => popoverOnOpenChange?.(true)}
    >
      {children}
    </button>
  ),
  PopoverContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock('@/components/ui/command', () => ({
  Command: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandEmpty: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  CommandGroup: ({ children }: { children: ReactNode }) => (
    <div role="listbox">{children}</div>
  ),
  CommandInput: ({ placeholder }: { placeholder?: string }) => (
    <input placeholder={placeholder} />
  ),
  CommandItem: ({
    children,
    onSelect,
    value,
  }: {
    children: ReactNode;
    onSelect: () => void;
    value: string;
  }) => (
    <button
      type="button"
      role="option"
      aria-label={value}
      aria-selected={false}
      onClick={onSelect}
    >
      {children}
    </button>
  ),
  CommandList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

// Must import after mocks
const { JumiaBrandSelector } = await import('./brand-selector');

const mockBrands = [
  { code: 1, name: 'Samsung' },
  { code: 2, name: 'Apple' },
];

describe('JumiaBrandSelector', () => {
  const defaultProps = {
    merchantId: 'merchant-1',
    value: null,
    onSelect: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    popoverOnOpenChange = undefined;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders without crashing', () => {
    render(<JumiaBrandSelector {...defaultProps} />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByText('Select Jumia Brand...')).toBeInTheDocument();
  });

  it('displays selected brand name when value is pre-selected', () => {
    render(
      <JumiaBrandSelector
        {...defaultProps}
        value={{ code: 1, name: 'Samsung' }}
      />
    );
    expect(screen.getByText('Samsung')).toBeInTheDocument();
  });

  it('shows the missing-merchant requirement and never fetches when merchantId is empty', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<JumiaBrandSelector {...defaultProps} merchantId="" />);

    // The requirement is surfaced immediately — not the loading spinner that
    // the 'idle' status would render.
    expect(
      screen.getByText('Merchant is required to load Jumia brands.')
    ).toBeInTheDocument();
    expect(screen.queryByText('Loading brands…')).not.toBeInTheDocument();

    // Opening the popover must not trigger a network request.
    fireEvent.click(screen.getByRole('combobox'));
    await waitFor(() => {
      expect(
        screen.getByText('Merchant is required to load Jumia brands.')
      ).toBeInTheDocument();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches and displays brands when opened', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ brands: mockBrands }),
      })
    );

    render(<JumiaBrandSelector {...defaultProps} />);

    // Click trigger to open the popover (calls onOpenChange(true))
    fireEvent.click(screen.getByRole('combobox'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/marketplace/jumia/brands?merchantId=merchant-1',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    await waitFor(() => {
      expect(
        screen.getByRole('option', { name: 'Samsung' })
      ).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Apple' })).toBeInTheDocument();
    });
  });

  it('calls onSelect with correct brand when clicked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ brands: mockBrands }),
      })
    );

    const onSelect = vi.fn();
    render(<JumiaBrandSelector {...defaultProps} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('combobox'));

    await waitFor(() => {
      expect(
        screen.getByRole('option', { name: 'Samsung' })
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('option', { name: 'Samsung' }));

    expect(onSelect).toHaveBeenCalledWith({ code: 1, name: 'Samsung' });
  });

  it('shows error UI on failed fetch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.reject(new Error('parse error')),
      })
    );

    render(<JumiaBrandSelector {...defaultProps} />);
    fireEvent.click(screen.getByRole('combobox'));

    await waitFor(() => {
      expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument();
    });

    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('retry triggers a new fetch', async () => {
    // After the first failed fetch, clicking Retry calls fetchBrands directly,
    // which aborts the prior controller and starts a new request. Provide
    // enough mocks to cover the initial failure plus the retry success.
    const successResponse = {
      ok: true,
      json: () => Promise.resolve({ brands: mockBrands }),
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValue(successResponse);

    vi.stubGlobal('fetch', fetchMock);

    render(<JumiaBrandSelector {...defaultProps} />);
    fireEvent.click(screen.getByRole('combobox'));

    await waitFor(() => {
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Retry'));

    await waitFor(() => {
      // After retry, brands should appear in the DOM
      expect(
        screen.getByRole('option', { name: 'Samsung' })
      ).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Apple' })).toBeInTheDocument();
    });
  });

  it('refetches exact scope when business client or integration changes', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ brands: mockBrands }),
    });
    vi.stubGlobal('fetch', fetcher);
    const { rerender } = render(
      <JumiaBrandSelector
        {...defaultProps}
        integrationId="old"
        businessClientCode="jumia-ng"
      />
    );
    fireEvent.click(screen.getByRole('combobox'));
    await screen.findByRole('option', { name: 'Samsung' });
    rerender(
      <JumiaBrandSelector
        {...defaultProps}
        integrationId="new"
        businessClientCode="jumia-gh"
      />
    );
    expect(
      screen.queryByRole('option', { name: 'Samsung' })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('combobox'));
    await waitFor(() =>
      expect(fetcher).toHaveBeenLastCalledWith(
        '/api/marketplace/jumia/brands?merchantId=merchant-1&integrationId=new&businessClientCode=jumia-gh',
        expect.anything()
      )
    );
  });
  it('reuses a successful catalog on reopen within the same exact destination', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ brands: mockBrands }),
    });
    vi.stubGlobal('fetch', fetcher);
    render(
      <JumiaBrandSelector
        {...defaultProps}
        integrationId="integration"
        businessClientCode="jumia-ng"
      />
    );
    fireEvent.click(screen.getByRole('combobox'));
    await screen.findByRole('option', { name: 'Samsung' });
    await act(async () => {
      popoverOnOpenChange?.(false);
    });
    await act(async () => {
      popoverOnOpenChange?.(true);
    });
    expect(screen.getByRole('option', { name: 'Samsung' })).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
