import { runFinalizeCheckoutPayment } from './run-finalize-checkout-payment';

describe('runFinalizeCheckoutPayment', () => {
  it('delegates the complete payment input without mutation', () => {
    const input = { selectedPayment: 'card' } as never;
    const mockFinalizeCheckoutPayment = jest.fn();
    runFinalizeCheckoutPayment(input, mockFinalizeCheckoutPayment);
    expect(mockFinalizeCheckoutPayment).toHaveBeenCalledWith(input);
  });
});
