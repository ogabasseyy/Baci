import { fireEvent, render } from '@testing-library/react-native';
import type { NativeCheckoutSnapshot } from '@/schemas/cart-checkout-snapshot';
import { CartCheckoutReviewNotice } from './CartCheckoutReviewNotice';

it('offers a retry after failed preparation without invoking order creation', () => {
  const onRetry = jest.fn().mockResolvedValue(undefined);
  const view = render(
    <CartCheckoutReviewNotice
      status="error"
      review={null}
      onRetry={onRetry}
      textColor="black"
    />
  );
  fireEvent.press(view.getByRole('button', { name: 'Retry cart review' }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});
it('does not restart an in-flight or completed review', () => {
  for (const status of ['idle', 'reviewing', 'ready', 'stale'] as const) {
    const view = render(
      <CartCheckoutReviewNotice
        status={status}
        review={null}
        onRetry={jest.fn()}
        textColor="black"
      />
    );
    expect(view.queryByRole('button')).toBeNull();
    view.unmount();
  }
});
it('warns when a reviewed line is unavailable or its price changed', () => {
  const review = {
    lines: [
      { available: false, priceChanged: false, negotiationInvalidated: false },
    ],
  } as unknown as NativeCheckoutSnapshot;
  const unavailable = render(
    <CartCheckoutReviewNotice
      status="ready"
      review={review}
      onRetry={jest.fn()}
      textColor="black"
    />
  );
  expect(unavailable.getByText(/Some items are unavailable/)).toBeTruthy();
  unavailable.unmount();

  const changed = {
    lines: [
      { available: true, priceChanged: true, negotiationInvalidated: false },
    ],
  } as unknown as NativeCheckoutSnapshot;
  const priceChanged = render(
    <CartCheckoutReviewNotice
      status="ready"
      review={changed}
      onRetry={jest.fn()}
      textColor="black"
    />
  );
  expect(priceChanged.getByText(/Prices or offers changed/)).toBeTruthy();
});
