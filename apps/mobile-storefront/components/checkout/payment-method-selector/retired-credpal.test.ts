import { PAYMENT_METHODS } from './paymentMethods';

it('does not offer CredPal while keeping the other installment methods', () => {
  const ids = PAYMENT_METHODS.map((method) => method.id);
  expect(ids).not.toContain('credpal');
  expect(ids).toEqual(expect.arrayContaining(['credit_direct', 'klump']));
});
