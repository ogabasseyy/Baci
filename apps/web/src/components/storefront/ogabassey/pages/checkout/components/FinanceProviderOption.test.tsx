import { fireEvent, render, screen } from '@testing-library/react';
import type { StaticImageData } from 'next/image';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaymentMethod } from '../types';
import { FinanceProviderOption } from './FinanceProviderOption';

const auth = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock('../hooks/use-checkout-session-user', () => ({ useCheckoutSessionUser: () => auth.user }));

const logo = {
  src: '/logos/oxygen-finance.png',
  width: 48,
  height: 40,
} as StaticImageData;

const oxygenBanks = [
  { name: 'Access Bank', code: '044' },
  { name: 'Zenith Bank', code: '057' },
];

function bankResponse(banks: ReadonlyArray<{ name: string; code: string }>): Response {
  return { ok: true, json: async () => ({ banks }) } as unknown as Response;
}

function failureResponse(): Response {
  return { ok: false, json: async () => ({}) } as unknown as Response;
}

function renderOption(
  provider: 'oxygen' | 'credit_direct',
  selected: boolean,
  onSelect: (value: PaymentMethod) => void = vi.fn()
) {
  return render(
    <FinanceProviderOption
      provider={provider}
      selected={selected}
      onSelect={onSelect}
      logo={logo}
    />
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  auth.user = null;
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('finance provider option', () => {
  it("renders Credit Direct from the merchant's static bank list without a network request", () => {
    renderOption('credit_direct', true);

    expect(screen.getByText('Credit Direct')).toBeVisible();
    expect(screen.getByText(/From 30% down/)).toBeVisible();
    expect(screen.getByText('3–6 months')).toBeVisible();
    expect(screen.getByText('24 supported banks')).toBeVisible();
    expect(screen.getByText('Piggyvest')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not request Oxygen banks until the option is selected', () => {
    renderOption('oxygen', false);

    expect(screen.getByText('Oxygen Finance')).toBeVisible();
    expect(screen.getByText(/From 25% down/)).toBeVisible();
    expect(screen.getByText('3–12 months')).toBeVisible();
    expect(screen.queryByText(/supported banks/)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the loading state and then the validated Oxygen bank list', async () => {
    let resolveResponse: (response: Response) => void = () => {};
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      })
    );

    renderOption('oxygen', true);

    expect(screen.getByText('Loading supported banks…')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/payments/oxygen/supported-banks',
      expect.objectContaining({ cache: 'no-store' })
    );

    resolveResponse(bankResponse(oxygenBanks));

    expect(await screen.findByText('2 supported banks')).toBeVisible();
    expect(
      screen.getByRole('region', { name: 'Oxygen Finance supported banks' })
    ).toBeInTheDocument();
    expect(screen.getByText('Access Bank')).toBeInTheDocument();
    expect(screen.getByText('Zenith Bank')).toBeInTheDocument();
  });

  it('reveals the scroll hint when more than eight banks are supported', async () => {
    fetchMock.mockResolvedValue(
      bankResponse(
        Array.from({ length: 9 }, (_, index) => ({
          name: `Bank ${index + 1}`,
          code: String(100 + index),
        }))
      )
    );

    renderOption('oxygen', true);

    expect(await screen.findByText('9 supported banks')).toBeVisible();
    expect(screen.getByText('Scroll ↓')).toBeVisible();
  });

  it('reports the bank list as unavailable when the endpoint fails', async () => {
    fetchMock.mockResolvedValue(failureResponse());

    renderOption('oxygen', true);

    expect(
      await screen.findByText('Bank list is temporarily unavailable.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('reports the bank list as unavailable when the payload fails validation', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ banks: [{ name: 'Broken Bank', code: 'not-a-code' }] }),
    } as unknown as Response);

    renderOption('oxygen', true);

    expect(
      await screen.findByText('Bank list is temporarily unavailable.')
    ).toBeInTheDocument();
  });

  it('cancels the in-flight request when the option is deselected', () => {
    let capturedSignal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      capturedSignal = init.signal ?? undefined;
      return new Promise<Response>(() => {});
    });

    const { rerender } = renderOption('oxygen', true);
    expect(capturedSignal?.aborted).toBe(false);

    rerender(
      <FinanceProviderOption
        provider="oxygen"
        selected={false}
        onSelect={vi.fn()}
        logo={logo}
      />
    );

    expect(capturedSignal?.aborted).toBe(true);
    expect(screen.queryByText('Loading supported banks…')).toBeNull();
  });

  it('forwards the provider when its radio input is selected', () => {
    const onSelect = vi.fn();
    renderOption('credit_direct', false, onSelect);

    fireEvent.click(screen.getByRole('radio', { name: /credit direct/i }));

    expect(onSelect).toHaveBeenCalledWith('credit_direct');
  });
});
