// Checkout commerce-brain mock, side-effect imported by
// checkout.test-utils.tsx. Kept separate per the Boy Scout Rule: the
// shared checkout utils file is over the 300-line budget, so touched mock
// groups live in dedicated helpers instead of extending it further.
jest.mock('@/lib/commerce-brain', () => ({
  calculateCommerce: jest.fn(
    (
      _name: string,
      params: {
        assuranceFee: number;
        shippingFee: number;
        subtotal: number;
        taxRate: number;
      }
    ) => {
      const taxAmount = Math.round(params.subtotal * params.taxRate);
      return Promise.resolve({
        taxAmount,
        total:
          params.subtotal +
          params.shippingFee +
          params.assuranceFee +
          taxAmount,
      });
    }
  ),
}));
