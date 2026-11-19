import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { projectOxygenTrialEvidence } from './activation-trial-evidence';

const reference = 'b75cd437-28af-4008-a1af-7e6810282833';
it('retains only payment completion booleans', () => {
  const evidence = projectOxygenTrialEvidence(
    'payment',
    200,
    {
      split_payment: { completed: true, account: 'private' },
      repayment_setup: { completed: false },
      email: 'buyer@example.com',
    },
    true,
    reference
  );
  expect(evidence).toMatchObject({
    payment: { splitPaymentCompleted: true, repaymentSetupCompleted: false },
  });
  expect(JSON.stringify(evidence)).not.toMatch(/private|buyer@example/);
});
it('retains matching activation terms but discards unknown fields and invalid values', () => {
  const evidence = projectOxygenTrialEvidence(
    'activate',
    200,
    {
      loan_reference: reference,
      status: 'ACTIVATED',
      loan_amount: 297000,
      product_amount: Number.MAX_VALUE,
      customer_token: 'private',
    },
    true,
    reference
  );
  expect(evidence).toMatchObject({
    activation: {
      loanReference: reference,
      status: 'ACTIVATED',
      terms: { loan_amount: 297000 },
    },
  });
  expect(JSON.stringify(evidence)).not.toMatch(/private|product_amount/);
});
it('never invents reference, status or completion for malformed responses', () => {
  expect(
    projectOxygenTrialEvidence(
      'activate',
      500,
      { loan_reference: 'other', status: 'private' },
      true,
      reference
    )
  ).toMatchObject({
    activation: { loanReference: null, status: null, terms: {} },
  });
  expect(
    projectOxygenTrialEvidence('payment', 500, undefined, false, reference)
  ).toMatchObject({
    format: 'non_json',
    payment: { splitPaymentCompleted: null, repaymentSetupCompleted: null },
  });
});
