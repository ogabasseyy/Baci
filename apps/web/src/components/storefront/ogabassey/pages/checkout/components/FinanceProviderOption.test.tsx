import { fireEvent, render, screen } from '@testing-library/react';
import type { StaticImageData } from 'next/image';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaymentMethod } from '../types';
import { FinanceProviderOption } from './FinanceProviderOption';

const auth = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock('@/contexts/auth-context', () => ({ useAuthSafe: () => ({ user: auth.user }) }));

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

  it('recovers from a temporary bank-list failure without reselecting the provider', async () => {
    let resolveRetry: (value: Response) => void = () => {};
    fetchMock.mockResolvedValueOnce(failureResponse()).mockReturnValueOnce(new Promise<Response>((resolve) => { resolveRetry = resolve; }));
    renderOption('oxygen', true);
    expect(await screen.findByText('Bank list is temporarily unavailable.')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Supported banks'));
    fireEvent.click(screen.getByRole('button', { name: /retry bank list/i }));
    expect(screen.getByText('Loading supported banks…')).toBeInTheDocument();
    resolveRetry(bankResponse(oxygenBanks));
    expect(await screen.findByText('2 supported banks')).toBeVisible();
  });

  it('explains when the bank-list request is rate limited', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, headers: new Headers({ 'Retry-After': '30' }) });
    renderOption('oxygen', true);
    expect(await screen.findByText(/try again in 30 seconds/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry bank list/i })).toBeDisabled();
  });

  it('retains the cooldown on reselection and expires it when the page resumes', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, headers: new Headers({ 'Retry-After': '30' }) }).mockResolvedValueOnce(bankResponse(oxygenBanks));
    const { rerender } = renderOption('oxygen', true);
    expect(await screen.findByText(/try again in 30 seconds/i)).toBeInTheDocument();
    rerender(<FinanceProviderOption provider="oxygen" selected={false} onSelect={vi.fn()} logo={logo} />);
    rerender(<FinanceProviderOption provider="oxygen" selected onSelect={vi.fn()} logo={logo} />);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /retry bank list/i })).toBeDisabled();
    clock.mockReturnValue(now + 31_000);
    fireEvent(document, new Event('visibilitychange'));
    fireEvent.click(screen.getByRole('button', { name: /retry bank list/i }));
    expect(await screen.findByText('2 supported banks')).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    clock.mockRestore();
  });

  it('reports an unavailable bank list if a retry after the cooldown fails', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, headers: new Headers({ 'Retry-After': '1' }) }).mockResolvedValueOnce(failureResponse());
    renderOption('oxygen', true);
    expect(await screen.findByText(/try again in 1 second/i)).toBeInTheDocument();
    clock.mockReturnValue(now + 2000);
    fireEvent(document, new Event('visibilitychange'));
    fireEvent.click(screen.getByText('Supported banks'));
    fireEvent.click(screen.getByRole('button', { name: /retry bank list/i }));
    expect(await screen.findByText('Bank list is temporarily unavailable.')).toBeInTheDocument();
    clock.mockRestore();
  });

  it('asks guests to sign in rather than offering an ineffective retry', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 });
    renderOption('oxygen', true);
    expect(await screen.findByText('Sign in to view supported banks.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry bank list/i })).toBeNull();
  });

  it('loads the bank list after a guest signs in', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 }).mockResolvedValueOnce(bankResponse(oxygenBanks));
    const { rerender } = renderOption('oxygen', true);
    expect(await screen.findByText('Sign in to view supported banks.')).toBeInTheDocument();
    auth.user = { id: 'customer-1' };
    rerender(<FinanceProviderOption provider="oxygen" selected onSelect={vi.fn()} logo={logo} />);
    expect(await screen.findByText('2 supported banks')).toBeVisible();
  });

  it('does not keep stale banks when selecting Oxygen again fails', async () => {
    fetchMock.mockResolvedValueOnce(bankResponse(oxygenBanks)).mockResolvedValueOnce(failureResponse());
    const { rerender } = renderOption('oxygen', true);
    expect(await screen.findByText('2 supported banks')).toBeVisible();
    rerender(<FinanceProviderOption provider="oxygen" selected={false} onSelect={vi.fn()} logo={logo} />);
    rerender(<FinanceProviderOption provider="oxygen" selected onSelect={vi.fn()} logo={logo} />);
    expect(await screen.findByText('Bank list is temporarily unavailable.')).toBeInTheDocument();
    expect(screen.queryByText('2 supported banks')).toBeNull();
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
