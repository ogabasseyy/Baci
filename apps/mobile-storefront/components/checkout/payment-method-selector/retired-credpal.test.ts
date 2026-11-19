import { PAYMENT_METHODS } from './paymentMethods';

it('does not offer retired CredPal or Klump while keeping Credit Direct', () => {
  const ids = PAYMENT_METHODS.map((method) => method.id);
  expect(ids).not.toContain('credpal');
  expect(ids).not.toContain('klump');
  expect(ids).toContain('credit_direct');
});
