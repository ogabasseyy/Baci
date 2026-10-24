import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JumiaProductExportEligiblePage } from '@/schemas/jumia/eligible-page';
import { GamingSelectionPreview } from './gaming-selection-preview';

const selectionId = '00000000-0000-4000-8000-000000000020';
const productId = '00000000-0000-4000-8000-000000000001';
const secondId = '00000000-0000-4000-8000-000000000002';
const version = 'a'.repeat(64);
function page(number = 1): JumiaProductExportEligiblePage {
  return {
    selectionId,
    sourceCategoryId: '00000000-0000-4000-8000-000000000010',
    total: 2,
    limit: 1,
    page: number,
    totalPages: 2,
    legacyUnmappedCount: 0,
    products: [
      {
        id: number === 1 ? productId : secondId,
        ordinal: number,
        available: true,
        unavailableReason: null,
        capturedSourceVersion: version,
        currentSourceVersion: version,
        product: { product: { name: number === 1 ? 'Gamepad' : 'Console' } },
      },
    ],
  };
}
let snapshot: JumiaProductExportEligiblePage = page();
const goToPage = vi.fn();
const createPreview = vi.fn();
vi.mock('./use-gaming-selection-preview', () => ({
  useGamingSelectionPreview: () => ({
    snapshot,
    loading: false,
    error: null,
    creationOutcomeUnknown: false,
    goToPage,
    createPreview,
  }),
}));

describe('Gaming selection draft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    snapshot = page();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        Response.json(
          page(
            Number(new URL(url, 'http://localhost').searchParams.get('page'))
          )
        )
      )
    );
  });

  it('starts empty, toggles individual products, preserves pages, and clears the draft', () => {
    const view = render(<GamingSelectionPreview merchantId="merchant-1" />);
    expect(screen.getByText('0 selected in draft')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Select Gamepad for draft' })
    );
    expect(screen.getByText('1 selected in draft')).toBeInTheDocument();
    snapshot = page(2);
    view.rerender(<GamingSelectionPreview merchantId="merchant-1" />);
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Select Console for draft' })
    );
    expect(screen.getByText('2 selected in draft')).toBeInTheDocument();
    snapshot = page();
    view.rerender(<GamingSelectionPreview merchantId="merchant-1" />);
    expect(
      screen.getByRole('checkbox', { name: 'Select Gamepad for draft' })
    ).toBeChecked();
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Select Gamepad for draft' })
    );
    expect(screen.getByText('1 selected in draft')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Clear draft selection' })
    );
    expect(screen.getByText('0 selected in draft')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /submit|publish/i })
    ).not.toBeInTheDocument();
  });

  it('selects eligible products across every frozen page with merchant context', async () => {
    render(<GamingSelectionPreview merchantId="merchant-1" />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Select all eligible' })
    );
    await screen.findByText('2 selected in draft');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith(
      expect.stringContaining(
        `selectionId=${selectionId}&merchantId=merchant-1&page=2`
      ),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('retains the previous draft on a failed page and offers a retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json(page()))
        .mockResolvedValueOnce(Response.json({}, { status: 500 }))
    );
    render(<GamingSelectionPreview merchantId="merchant-1" />);
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Select Gamepad for draft' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Select all eligible' })
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /draft unchanged.*retry/i
    );
    expect(screen.getByText('1 selected in draft')).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: 'Select Gamepad for draft' })
    ).toBeChecked();
  });

  it('makes changed and unavailable rows ineligible but allows removal of an invalid selected row', () => {
    const view = render(<GamingSelectionPreview merchantId="merchant-1" />);
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Select Gamepad for draft' })
    );
    snapshot = {
      ...page(),
      products: [
        { ...page().products[0], currentSourceVersion: 'b'.repeat(64) },
      ],
    };
    view.rerender(<GamingSelectionPreview merchantId="merchant-1" />);
    expect(screen.getByRole('alert')).toHaveTextContent(/deselect.*refresh/i);
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Select Gamepad for draft' })
    );
    expect(
      screen.getByRole('checkbox', { name: 'Select Gamepad for draft' })
    ).toBeDisabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    snapshot = {
      ...page(),
      products: [
        {
          ...page().products[0],
          available: false,
          unavailableReason: 'inactive',
        },
      ],
    };
    view.rerender(<GamingSelectionPreview merchantId="merchant-1" />);
    expect(
      screen.getByRole('checkbox', { name: 'Select Gamepad for draft' })
    ).toBeDisabled();
  });

  it('resets on merchant or immutable selection replacement and on unmount', () => {
    const view = render(<GamingSelectionPreview merchantId="merchant-1" />);
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Select Gamepad for draft' })
    );
    view.rerender(<GamingSelectionPreview merchantId="merchant-2" />);
    expect(screen.getByText('0 selected in draft')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Select Gamepad for draft' })
    );
    snapshot = {
      ...page(),
      selectionId: '00000000-0000-4000-8000-000000000021',
    };
    view.rerender(<GamingSelectionPreview merchantId="merchant-2" />);
    expect(screen.getByText('0 selected in draft')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Select Gamepad for draft' })
    );
    view.unmount();
    render(<GamingSelectionPreview merchantId="merchant-2" />);
    expect(screen.getByText('0 selected in draft')).toBeInTheDocument();
  });

  it('aborts bulk reads on scope replacement and ignores late completion', async () => {
    let resolvePage: (response: Response) => void = () => {};
    const fetcher = vi.fn(
      (_url: string, _options: RequestInit) =>
        new Promise<Response>((resolve) => {
          resolvePage = resolve;
        })
    );
    vi.stubGlobal('fetch', fetcher);
    const view = render(<GamingSelectionPreview merchantId="merchant-1" />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Select all eligible' })
    );
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    expect(
      screen.getByRole('button', { name: 'Select all eligible' })
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    view.rerender(<GamingSelectionPreview merchantId="merchant-2" />);
    expect(fetcher.mock.calls[0][1].signal?.aborted).toBe(true);
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Select Gamepad for draft' })
    );
    await act(async () => resolvePage(Response.json(page())));
    expect(screen.getByText('1 selected in draft')).toBeInTheDocument();
  });

  it('clearing during a bulk read cancels it and fences a late result', async () => {
    let resolvePage: (response: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolvePage = resolve;
          })
      )
    );
    render(<GamingSelectionPreview merchantId="merchant-1" />);
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Select Gamepad for draft' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Select all eligible' })
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    fireEvent.click(
      screen.getByRole('button', { name: 'Clear draft selection' })
    );
    await act(async () => resolvePage(Response.json(page())));
    expect(screen.getByText('0 selected in draft')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('retains an invalid observation across pages until explicit deselection', () => {
    const view = render(<GamingSelectionPreview merchantId="merchant-1" />);
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Select Gamepad for draft' })
    );
    snapshot = {
      ...page(),
      products: [{ ...page().products[0], available: false }],
    };
    view.rerender(<GamingSelectionPreview merchantId="merchant-1" />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      '1 selected products are no longer valid'
    );
    snapshot = page(2);
    view.rerender(<GamingSelectionPreview merchantId="merchant-1" />);
    expect(screen.getByRole('alert')).toHaveTextContent(/deselect/i);
    snapshot = page();
    view.rerender(<GamingSelectionPreview merchantId="merchant-1" />);
    expect(screen.getByRole('alert')).toHaveTextContent(/deselect/i);
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Select Gamepad for draft' })
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('aborts an in-flight bulk read when the preview unmounts', async () => {
    const fetcher = vi.fn(
      (_url: string, _options: RequestInit) => new Promise<Response>(() => {})
    );
    vi.stubGlobal('fetch', fetcher);
    const view = render(<GamingSelectionPreview merchantId="merchant-1" />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Select all eligible' })
    );
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    view.unmount();
    expect(fetcher.mock.calls[0][1].signal?.aborted).toBe(true);
  });
});
