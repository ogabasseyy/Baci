import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { submitNegotiationUpload } from './negotiation-modal-upload';
import { useNegotiationModalController } from './use-negotiation-modal-controller';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(() => ({ auth: { getUser: vi.fn() } })),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: mocks.createClient,
}));

vi.mock('./negotiation-modal-upload', () => ({
  submitNegotiationUpload: vi.fn(),
}));

const options = {
  currentPrice: 100_000,
  isOpen: true,
  merchantId: 'merchant-1',
  onSuccess: vi.fn(),
  productName: 'Negotiable Phone',
  type: 'single' as const,
  vatRate: 0,
};

describe('useNegotiationModalController', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('rejects an offer above the current price', () => {
    const { result } = renderHook(() =>
      useNegotiationModalController(options)
    );
    act(() => result.current.setOffer('100001'));
    act(() =>
      result.current.handleSubmit({ preventDefault: vi.fn() } as never)
    );

    expect(result.current.status).toBe('input');
    expect(result.current.message).toContain(
      `between ₦1 and ₦${options.currentPrice.toLocaleString()}`
    );
  });

  it('accepts an offer inside the automatic threshold', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useNegotiationModalController(options)
    );
    act(() => result.current.setOffer('98000'));
    act(() =>
      result.current.handleSubmit({ preventDefault: vi.fn() } as never)
    );
    act(() => vi.advanceTimersByTime(1500));

    expect(result.current.status).toBe('success');
    expect(options.onSuccess).toHaveBeenCalledWith(98_000);
  });

  it('returns a counter offer for an offer below the automatic threshold', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useNegotiationModalController(options)
    );
    act(() => result.current.setOffer('80000'));
    act(() =>
      result.current.handleSubmit({ preventDefault: vi.fn() } as never)
    );
    act(() => vi.advanceTimersByTime(1500));

    expect(result.current.status).toBe('failed');
    expect(result.current.counterOffer).toBe(99_000);
    expect(result.current.attemptCount).toBe(1);
  });

  it('accepts a counter offer and reports its final price', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useNegotiationModalController(options)
    );
    act(() => result.current.setOffer('80000'));
    act(() =>
      result.current.handleSubmit({ preventDefault: vi.fn() } as never)
    );
    act(() => vi.advanceTimersByTime(1500));

    act(() => result.current.handleAcceptCounter());

    expect(result.current.status).toBe('success');
    expect(options.onSuccess).toHaveBeenCalledWith(99_000);
  });

  it('does not accept a missing counter offer', () => {
    const { result } = renderHook(() =>
      useNegotiationModalController(options)
    );

    act(() => result.current.handleAcceptCounter());

    expect(result.current.status).toBe('input');
    expect(options.onSuccess).not.toHaveBeenCalled();
  });

  it('forwards the contact and evidence fields to upload submission', async () => {
    vi.mocked(submitNegotiationUpload).mockResolvedValue(undefined);
    const file = new File(['proof'], 'proof.png', { type: 'image/png' });
    const { result } = renderHook(() =>
      useNegotiationModalController(options)
    );
    act(() => {
      result.current.setEmail('buyer@example.com');
      result.current.setOffer('90000');
      result.current.setPhone('08031234567');
      result.current.setUploadFile(file);
      result.current.setUploadLink('');
    });

    await act(async () => {
      await result.current.handleUploadSubmit({
        preventDefault: vi.fn(),
      } as never);
    });

    expect(submitNegotiationUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'buyer@example.com',
        offer: '90000',
        phone: '08031234567',
        uploadFile: file,
        uploadLink: '',
      })
    );
  });

  it('rejects an invalid evidence form before loading the Supabase client', async () => {
    vi.stubGlobal('alert', vi.fn());
    const { result } = renderHook(() =>
      useNegotiationModalController(options)
    );

    // Default state (empty offer, no evidence) is immediately rejectable:
    // feedback must surface without downloading the client chunk.
    await act(async () => {
      await result.current.handleUploadSubmit({
        preventDefault: vi.fn(),
      } as never);
    });

    expect(alert).toHaveBeenCalledWith(
      'Upload proof or paste a link before sending your request.'
    );
    expect(submitNegotiationUpload).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('keeps a discounted non-negotiable product at its final price', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useNegotiationModalController({ ...options, productBrand: 'Tecno' })
    );
    act(() => result.current.setOffer('90000'));
    act(() =>
      result.current.handleSubmit({ preventDefault: vi.fn() } as never)
    );
    act(() => vi.advanceTimersByTime(1500));

    expect(result.current.status).toBe('final');
    expect(result.current.counterOffer).toBeNull();
  });

  it('resets offer and contact state when the modal reopens', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ isOpen }) =>
        useNegotiationModalController({ ...options, isOpen }),
      { initialProps: { isOpen: true } }
    );
    act(() => {
      result.current.setOffer('80000');
      result.current.setEmail('buyer@example.com');
      result.current.setPhone('08031234567');
    });
    act(() =>
      result.current.handleSubmit({ preventDefault: vi.fn() } as never)
    );
    act(() => vi.advanceTimersByTime(1500));
    expect(result.current.attemptCount).toBe(1);

    rerender({ isOpen: false });
    rerender({ isOpen: true });

    expect(result.current.offer).toBe('');
    expect(result.current.status).toBe('input');
    expect(result.current.email).toBe('');
    expect(result.current.phone).toBe('');
    expect(result.current.attemptCount).toBe(0);
  });
});
