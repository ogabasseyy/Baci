import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithCsrf } from '@/lib/api-client';
import { ChatDeliveryQuote, parseDestinationState } from './chat-delivery-quote';

vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: vi.fn() }));

const quote = {
  id: 'quote-1', provider: 'MERCHANT', serviceTier: 'Standard', carrierName: 'Store delivery',
  displayName: 'Standard delivery', estimatedDays: 3, price: 2500, currency: 'NGN',
  pickupIncluded: false, insuranceIncluded: false,
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(fetchWithCsrf).mockReset();
  vi.mocked(fetchWithCsrf).mockImplementation((url, options) => fetch(url, options));
});

describe('ChatDeliveryQuote', () => {
  it('fails closed for negated, corrected, or country-ambiguous state mentions', () => {
    expect(parseDestinationState('Please deliver to Lagos')).toEqual({ kind: 'matched', stateName: 'Lagos' });
    expect(parseDestinationState('Not Lagos')).toEqual({ kind: 'ambiguous' });
    expect(parseDestinationState('Lagos is not my destination')).toEqual({ kind: 'ambiguous' });
    expect(parseDestinationState('No. 12 Long Street, Lagos')).toEqual({ kind: 'matched', stateName: 'Lagos' });
    expect(parseDestinationState('No. 12 Long Street, lagos')).toEqual({ kind: 'matched', stateName: 'Lagos' });
    expect(parseDestinationState('Not Lagos, I mean Ogun')).toEqual({ kind: 'ambiguous' });
    expect(parseDestinationState('I am moving to Niger Republic')).toEqual({ kind: 'ambiguous' });
    expect(parseDestinationState('I live in Niger State')).toEqual({ kind: 'matched', stateName: 'Niger' });
  });

  it('keeps natural destination text private and submits only a confirmed canonical state', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sessionId: 's1', quotes: { all: [quote], featured: [quote] } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const setInput = vi.fn();
    const submitRef = { current: null as (() => void) | null };
    render(<ChatDeliveryQuote cartKey="cart-v1" input="I live in Ikeja, Lagos" setInput={setInput} submitRef={submitRef} onComposerLockChange={vi.fn()} onClose={vi.fn()} />);
    const privateCard = screen.getByRole('region', { name: 'Private delivery estimate' });
    expect(screen.getByText('Destination')).toBeInTheDocument();
    expect(screen.queryByLabelText('Destination')).not.toBeInTheDocument();
    expect(privateCard).toHaveAttribute('data-ph-no-autocapture', '');
    expect(privateCard).toHaveAttribute('data-ph-block', '');
    expect(privateCard).toHaveAttribute('data-session-replay-block', '');

    expect(screen.queryByText(/I live in Ikeja/)).not.toBeInTheDocument();
    await act(async () => { submitRef.current?.(); });
    expect(screen.getByText(/Use this state for a store-rate estimate/i)).toBeInTheDocument();
    expect(setInput).toHaveBeenCalledWith('');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces ambiguity without sending any destination text', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const submitRef = { current: null as (() => void) | null };
    render(<ChatDeliveryQuote cartKey="cart-v1" input="I live between Lagos and Abuja" setInput={vi.fn()} submitRef={submitRef} onComposerLockChange={vi.fn()} onClose={vi.fn()} />);
    await act(async () => { submitRef.current?.(); });
    expect(screen.getByRole('alert')).toHaveTextContent(/conflicting states/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/Lagos and Abuja/)).not.toBeInTheDocument();
  });

  it('requires confirmation and sends only the state, never the full private destination', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sessionId: 's1', quotes: { all: [quote], featured: [quote] } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const submitRef = { current: null as (() => void) | null };
    render(<ChatDeliveryQuote cartKey="cart-v1" input="I live at 12 Long Street in Ikeja, Lagos" setInput={vi.fn()} submitRef={submitRef} onComposerLockChange={vi.fn()} onClose={vi.fn()} />);
    await act(async () => { submitRef.current?.(); });
    expect(screen.getByText(/Use this state for a store-rate estimate/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Yes, check estimate' }));
    expect(await screen.findByText('Standard delivery')).toBeInTheDocument();
    expect(fetchWithCsrf).toHaveBeenCalledWith('/api/chat/delivery-estimate', expect.objectContaining({
      method: 'POST',
    }));
    expect(fetchMock).toHaveBeenCalledWith('/api/chat/delivery-estimate', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ state: 'Lagos' }),
    }));
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('12 Long Street');
  });

  it('explains missing state and avoids claiming there are multiple states', async () => {
    const submitRef = { current: null as (() => void) | null };
    render(<ChatDeliveryQuote cartKey="cart-v1" input="I live in Ikeja" setInput={vi.fn()} submitRef={submitRef} onComposerLockChange={vi.fn()} onClose={vi.fn()} />);
    await act(async () => { submitRef.current?.(); });
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn’t identify a Nigerian state/i);
  });

  it('does not display an unknown delivery duration as zero days', async () => {
    const noEtaQuote = { ...quote, estimatedDays: 0 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sessionId: 's1', quotes: { all: [noEtaQuote], featured: [noEtaQuote] } }),
    }));
    const submitRef = { current: null as (() => void) | null };
    render(<ChatDeliveryQuote cartKey="cart-v1" input="Delivery to Lagos" setInput={vi.fn()} submitRef={submitRef} onComposerLockChange={vi.fn()} onClose={vi.fn()} />);
    await act(async () => { submitRef.current?.(); });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Yes, check estimate' }));
    expect(await screen.findByText('Standard delivery')).toBeInTheDocument();
    expect(screen.queryByText(/0 days/i)).not.toBeInTheDocument();
  });

  it('aborts and clears a result when the cart context changes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sessionId: 's1', quotes: { all: [quote], featured: [quote] } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const submitRef = { current: null as (() => void) | null };
    const props = { cartKey: 'cart-v1', input: 'Delivery to Lagos', setInput: vi.fn(), submitRef, onComposerLockChange: vi.fn(), onClose: vi.fn() };
    const view = render(<ChatDeliveryQuote {...props} />);
    await act(async () => { submitRef.current?.(); });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Yes, check estimate' }));
    await screen.findByText('Standard delivery');
    view.rerender(<ChatDeliveryQuote {...props} cartKey="cart-v2" />);
    expect(screen.queryByText('Standard delivery')).not.toBeInTheDocument();
  });
});
