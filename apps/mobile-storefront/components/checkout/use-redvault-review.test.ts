import { jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import type { RedvaultReviewInput } from './redvault/RedvaultOrderReview';
import { useRedvaultReview } from './use-redvault-review';

const reviewInput = {} as RedvaultReviewInput;

describe('useRedvaultReview', () => {
  it('clears the review and resets checkout payment selection on close', () => {
    const resetPaymentSelection = jest.fn();
    const setStep = jest.fn();
    const { result } = renderHook(() =>
      useRedvaultReview({ resetPaymentSelection, setStep })
    );

    act(() => result.current.openRedvaultReview(reviewInput));
    expect(result.current.redvaultReview).toBe(reviewInput);

    act(() => result.current.closeRedvaultReview());
    expect(result.current.redvaultReview).toBeNull();
    expect(resetPaymentSelection).toHaveBeenCalledTimes(1);
    expect(setStep).toHaveBeenCalledWith('payment');
  });
});
