import 'server-only';
import { ZodError } from 'zod';
import type { OxygenProviderDiagnostic } from '@/schemas/oxygen-provider-diagnostic';
import type { OxygenResponseMetadata } from './provider';
import { oxygenDiagnostic } from './provider-diagnostic';

const fields = new Set([
  'loan_request_reference',
  'partner_reference',
  'is_eligible',
  'status',
  'message',
  'eligible_amount',
  'max_loan_amount',
  'minimum_loan_amount',
  'max_tenure',
  'eligible',
  'successful',
  'response_code',
  'error',
  'errors',
  'loan_reference',
  'product_amount',
  'loan_amount',
  'equity_percentage',
  'equity_amount',
  'loan_tenure',
  'total_charges',
  'total_upfront_payment',
  'repayment_schedule',
  'repayment_amount',
  'repayment_date',
  'amount',
  'date',
  'phone_status',
  'bvn_status',
  'nin_status',
  'bank_status',
  'selfie_status',
  'address_status',
  'split_payment',
  'repayment_setup',
  'completed',
  'url',
  'token',
  'context',
  'state',
  'command',
  'action',
  'workflowId',
  'version',
]);
type CheckedField =
  | 'loan_request_reference'
  | 'partner_reference'
  | 'eligible_amount'
  | 'max_loan_amount'
  | 'minimum_loan_amount'
  | 'max_tenure';
export class OxygenLocalValidationError extends Error {
  constructor(
    readonly reason: 'reference_mismatch' | 'required_field_missing',
    readonly fields: CheckedField[]
  ) {
    super('Oxygen response validation failed');
  }
}

/** Never serialize Zod messages, input values, unknown object keys or arbitrary errors. */
export function oxygenLocalValidationDiagnostic(
  failure: unknown,
  operation: OxygenProviderDiagnostic['operation'],
  metadata: OxygenResponseMetadata | undefined,
  startedAt: number,
  uncertain = false
): OxygenProviderDiagnostic {
  const received = metadata?.operation === operation ? metadata : undefined;
  const diagnostic = oxygenDiagnostic(
    operation,
    received ? 'invalid_response' : 'validation',
    received || uncertain ? 'indeterminate' : 'not_sent',
    startedAt
  );
  if (received) {
    diagnostic.httpStatus = received.httpStatus;
    diagnostic.capture = received.capture;
    diagnostic.providerRequestId =
      received.requestId &&
      /^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.test(
        received.requestId
      )
        ? received.requestId
        : null;
  }
  if (failure instanceof ZodError) {
    diagnostic.providerCode = 'RESPONSE_SCHEMA_INVALID';
    diagnostic.providerMessage = JSON.stringify({
      check: 'schema',
      issues: failure.issues.slice(0, 6).map((issue) => ({
        field:
          issue.path
            .slice(0, 6)
            .map((part) =>
              typeof part === 'number'
                ? '[item]'
                : typeof part === 'string' && fields.has(part)
                  ? part
                  : '[field]'
            )
            .join('.')
            .slice(0, 96) || '[response]',
        code: issue.code,
      })),
    });
  } else if (failure instanceof OxygenLocalValidationError) {
    diagnostic.providerCode =
      failure.reason === 'reference_mismatch'
        ? 'PROVIDER_REFERENCE_MISMATCH'
        : 'REQUIRED_RESPONSE_FIELD_MISSING';
    diagnostic.providerMessage = JSON.stringify({
      check: failure.reason,
      fields: failure.fields.filter((field) => fields.has(field)).slice(0, 6),
    });
  } else {
    diagnostic.providerCode = 'LOCAL_VALIDATION_FAILED';
    diagnostic.providerMessage =
      'A local validation check failed; no error text or response values were retained.';
  }
  return diagnostic;
}
