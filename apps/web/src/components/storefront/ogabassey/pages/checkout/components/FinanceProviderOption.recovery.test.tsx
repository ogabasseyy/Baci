import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

describe('finance provider bank recovery', () => {
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

  it('allows an immediate retry when the server returns Retry-After: 0', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, headers: new Headers({ 'Retry-After': '0' }) }).mockResolvedValueOnce(bankResponse(oxygenBanks));
    renderOption('oxygen', true);
    const retry = await screen.findByRole('button', { name: /retry bank list/i });
    expect(retry).toBeEnabled();
    fireEvent.click(retry);
    expect(await screen.findByText('2 supported banks')).toBeVisible();
  });

  it('enables retry when the cooldown expires while the page stays visible', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, headers: new Headers({ 'Retry-After': '1' }) }).mockResolvedValueOnce(bankResponse(oxygenBanks));
    renderOption('oxygen', true);
    const retry = await screen.findByRole('button', { name: /retry bank list/i });
    expect(retry).toBeDisabled();
    await waitFor(() => expect(retry).toBeEnabled(), { timeout: 3000 });
    fireEvent.click(retry);
    expect(await screen.findByText('2 supported banks')).toBeVisible();
  });

  it('clears a user-scoped cooldown when a different customer signs in', async () => {
    auth.user = { id: 'first' };
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, headers: new Headers({ 'Retry-After': '30', 'X-Oxygen-Rate-Limit-Scope': 'user' }) }).mockResolvedValueOnce(bankResponse(oxygenBanks));
    const { rerender } = renderOption('oxygen', true);
    expect(await screen.findByText(/try again in 30 seconds/i)).toBeInTheDocument();
    auth.user = { id: 'second' };
    rerender(<FinanceProviderOption provider="oxygen" selected onSelect={vi.fn()} logo={logo} />);
    expect(await screen.findByText('2 supported banks')).toBeVisible();
  });

  it('honors the server owner when the local session has not loaded yet', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, headers: new Headers({ 'Retry-After': '30', 'X-Oxygen-Rate-Limit-Scope': 'user', 'X-Oxygen-Rate-Limit-User': 'first' }) }).mockResolvedValueOnce(bankResponse(oxygenBanks));
    const { rerender } = renderOption('oxygen', true);
    expect(await screen.findByText(/try again in 30 seconds/i)).toBeInTheDocument();
    auth.user = { id: 'second' };
    rerender(<FinanceProviderOption provider="oxygen" selected onSelect={vi.fn()} logo={logo} />);
    expect(await screen.findByText('2 supported banks')).toBeVisible();
  });

  it('does not retry when the delayed local session matches the server owner', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, headers: new Headers({ 'Retry-After': '30', 'X-Oxygen-Rate-Limit-Scope': 'user', 'X-Oxygen-Rate-Limit-User': 'first' }) });
    const { rerender } = renderOption('oxygen', true);
    expect(await screen.findByText(/try again in 30 seconds/i)).toBeInTheDocument();
    auth.user = { id: 'first' };
    rerender(<FinanceProviderOption provider="oxygen" selected onSelect={vi.fn()} logo={logo} />);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves an unscoped cooldown when a different customer signs in', async () => {
    auth.user = { id: 'first' };
    fetchMock.mockResolvedValue({ ok: false, status: 429, headers: new Headers({ 'Retry-After': '30' }) });
    const { rerender } = renderOption('oxygen', true);
    expect(await screen.findByText(/try again in 30 seconds/i)).toBeInTheDocument();
    auth.user = { id: 'second' };
    rerender(<FinanceProviderOption provider="oxygen" selected onSelect={vi.fn()} logo={logo} />);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /retry bank list/i })).toBeDisabled();
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

});
