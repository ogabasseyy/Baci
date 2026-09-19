import { jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import type { RedvaultReviewInput } from './redvault/RedvaultOrderReview';
import { useRedvaultReview } from './use-redvault-review';

const reviewInput = {
  orderResponse: { order: { id: 'order-1' } },
} as RedvaultReviewInput;
const mockFetchJson = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.mock('@/lib/storefront-customer-api-client', () => ({
  createStorefrontCustomerApiClient: () => ({
    fetchJson: (...args: unknown[]) => mockFetchJson(...args),
  }),
}));

describe('useRedvaultReview', () => {
  beforeEach(() => {
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
});
