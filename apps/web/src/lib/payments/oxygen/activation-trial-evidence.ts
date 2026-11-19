import 'server-only';
import type { OxygenActivationTrialOperation } from './activation-trial';

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Keep only fields needed to understand this trial, never the raw response. */
export function projectOxygenTrialEvidence(
  operation: OxygenActivationTrialOperation,
  status: number,
  body: unknown,
  parsed: boolean,
  reference: string
) {
  const root = object(body);
  const capture = {
    operation,
    httpStatus: status,
    receivedAt: new Date().toISOString(),
    format: parsed ? 'json' : 'non_json',
  };
  if (operation === 'payment') {
    const split = object(root?.split_payment)?.completed;
    const repayment = object(root?.repayment_setup)?.completed;
    return {
      ...capture,
      payment: {
        splitPaymentCompleted: typeof split === 'boolean' ? split : null,
        repaymentSetupCompleted:
          typeof repayment === 'boolean' ? repayment : null,
      },
    };
  }
  const terms: Record<string, number> = {};
  for (const field of [
    'loan_amount',
    'product_amount',
    'equity_percentage',
    'equity_amount',
    'total_charges',
    'total_upfront_payment',
    'first_repayment',
    'loan_tenure',
  ] as const) {
    const value = root?.[field];
    if (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      Math.abs(value) <= Number.MAX_SAFE_INTEGER
    )
      terms[field] = value;
  }
  return {
    ...capture,
    activation: {
      loanReference: root?.loan_reference === reference ? reference : null,
      status: root?.status === 'ACTIVATED' ? 'ACTIVATED' : null,
      terms,
    },
  };
}
