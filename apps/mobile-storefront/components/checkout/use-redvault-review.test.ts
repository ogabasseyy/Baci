import { jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { RedvaultReviewInput } from './redvault/RedvaultOrderReview';
import { useRedvaultReview } from './use-redvault-review';

const reviewInput = {
  orderResponse: { order: { id: 'order-1' } },
} as RedvaultReviewInput;
const guestReviewInput = {
  orderResponse: { order: { id: 'order-1', tracking_token: 'track-1' } },
} as RedvaultReviewInput;
const mockFetchJson = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.mock('@/lib/storefront-customer-api-client', () => ({
  createStorefrontCustomerApiClient: () => ({
    fetchJson: (...args: unknown[]) => mockFetchJson(...args),
  }),
}));

describe('useRedvaultReview', () => {
  beforeEach(() => {
    mockFetchJson.mockClear();
    mockFetchJson.mockResolvedValue({ success: true });
  });
  it('clears the review and resets checkout payment selection on close', async () => {
    const resetPaymentSelection = jest.fn();
    const setStep = jest.fn();
    const { result } = renderHook(() =>
      useRedvaultReview({ resetPaymentSelection, setStep })
    );

    act(() => result.current.openRedvaultReview(reviewInput));
    expect(result.current.redvaultReview).toBe(reviewInput);

    await act(async () => {
      await result.current.closeRedvaultReview();
    });
    expect(result.current.redvaultReview).toBeNull();
    expect(resetPaymentSelection).toHaveBeenCalledTimes(1);
    expect(setStep).toHaveBeenCalledWith('payment');
  });

  it('lets a guest cancel through the tracking-token route', async () => {
    global.fetch = jest.fn(async () =>
      Response.json({ success: true, cancelled: true })
    ) as any;
    const resetPaymentSelection = jest.fn();
    const setStep = jest.fn();
    const { result } = renderHook(() =>
      useRedvaultReview({ resetPaymentSelection, setStep })
    );

    act(() => result.current.openRedvaultReview(guestReviewInput));
    await act(async () => {
      await result.current.closeRedvaultReview();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/storefront\/orders\/order-1\/cancel$/),
      expect.objectContaining({ method: 'POST' })
    );
    expect(result.current.redvaultReview).toBeNull();
    expect(resetPaymentSelection).toHaveBeenCalledTimes(1);
    expect(mockFetchJson).not.toHaveBeenCalled();
  });

  it('keeps the review open when the order is already live', async () => {
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    global.fetch = jest.fn(
      async () => new Response('{}', { status: 409 })
    ) as any;
    const resetPaymentSelection = jest.fn();
    const setStep = jest.fn();
    const { result } = renderHook(() =>
      useRedvaultReview({ resetPaymentSelection, setStep })
    );

    act(() => result.current.openRedvaultReview(guestReviewInput));
    await act(async () => {
      await result.current.closeRedvaultReview();
    });

    expect(result.current.redvaultReview).toBe(guestReviewInput);
    expect(resetPaymentSelection).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      'Payment in progress',
      expect.any(String)
    );
    alertSpy.mockRestore();
  });
});
