import { fireEvent, render } from '@testing-library/react-native';
import { CartCheckoutReviewNotice } from './CartCheckoutReviewNotice';

it('offers a retry after failed preparation without invoking order creation', () => {
  const onRetry = jest.fn().mockResolvedValue(undefined);
  const view = render(
    <CartCheckoutReviewNotice
      status="error"
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
        onRetry={jest.fn()}
        textColor="black"
      />
    );
    expect(view.queryByRole('button')).toBeNull();
    view.unmount();
  }
});
