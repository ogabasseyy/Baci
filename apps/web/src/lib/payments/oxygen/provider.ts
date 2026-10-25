import 'server-only';
import type { OxygenProviderDiagnostic } from '@/schemas/oxygen-provider-diagnostic';
import {
  oxygenActiveLoanCode,
  oxygenStatementRequiredCode,
} from './booking-rejection';
import { oxygenInvalidOtpCode } from './otp-rejection';
import {
  oxygenDiagnostic,
  readOxygenFailureDiagnostic,
} from './provider-diagnostic';
import type { OxygenObservedResponse } from './response-evidence';
import type { OxygenRuntimeRpc } from './runtime-service';
import { OxygenTransportError } from './transport';

const paths = {
  banks: '/v1/eligibility/banks',
  name_enquiry: '/v1/partner-loans/name-enquiry',
  create: '/v1/loan-request/create',
  resend_existing: '/v1/loan-request/retrigger/otp/existing/user',
  resend_new: '/v1/loan-request/retrigger/otp/new/user',
  validate_existing: '/v1/loan-request/validate/existing/user',
  validate_new: '/v1/loan-request/validate/new/user',
  kyc: '/v1/loan-request/validate/kyc/status',
  nin: '/v1/loan-request/validate/nin',
  selfie: '/v1/loan-request/validate/selfie',
  address: '/v1/loan-request/validate/address',
  eligibility: '/v1/loan-request/get',
  book: '/v1/partner-loans/book-loan',
  details: '/v1/partner-loans/details',
  cancel: '/v1/partner-loans/cancel',
  approval_otp: '/v1/partner-loans/approve-loan/trigger-otp',
  approve: '/v1/partner-loans/approve-loan',
  payment: '/v1/partner-loans/split-payment-setup/confirmation',
  upfront_link: '/v1/partner-loans/send/split/payment-setup',
  repayment_link: '/v1/partner-loans/send/payment-setup',
} as const;
export type OxygenProviderOperation = keyof typeof paths;
export class OxygenProviderFailure extends Error {
  constructor(
    public readonly outcome: 'not_sent' | 'rejected' | 'indeterminate',
    public readonly code?:
      | typeof oxygenActiveLoanCode
      | typeof oxygenStatementRequiredCode
      | typeof oxygenInvalidOtpCode,
    public readonly diagnostic?: OxygenProviderDiagnostic
  ) {
    super('Oxygen request could not be confirmed');
  }
}
export interface OxygenProvider {
  forCommand?: (
    worker: OxygenRuntimeRpc,
    workflowId: string,
    commandId: string
  ) => OxygenProvider;
  call(
    operation: OxygenProviderOperation,
    input: Record<string, unknown> | FormData
  ): Promise<unknown>;
}
/** Fixed staging origin and operation allowlist. No activation or settlement API. */
export function createOxygenProvider(deps: {
  token(): Promise<string>;
  fetch: typeof fetch;
  redactionSecrets?: string[];
  observe?: (response: OxygenObservedResponse) => Promise<void>;
}): OxygenProvider {
  return {
    async call(operation, input) {
      if (!Object.hasOwn(paths, operation))
        throw new Error('Unsupported Oxygen operation');
      const startedAt = Date.now();
      let token: string;
      try {
        token = await deps.token();
      } catch (failure) {
        const diagnostic = oxygenDiagnostic(
          operation,
          'authentication',
          'not_sent',
          startedAt
        );
        if (failure instanceof OxygenTransportError) {
          diagnostic.httpStatus = failure.status ?? null;
          diagnostic.providerCode = failure.code;
          diagnostic.providerMessage = failure.message;
        }
        throw new OxygenProviderFailure('not_sent', undefined, diagnostic);
      }
      let receivedResponse = false;
      try {
        const multipart = input instanceof FormData;
        const response = await deps.fetch(
          `https://staging-api.theoxygen.com/services/partners${paths[operation]}`,
          {
            method: operation === 'banks' ? 'GET' : 'POST',
            cache: 'no-store',
            redirect: 'error',
            signal: AbortSignal.timeout(30_000),
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/json',
              ...(!multipart ? { 'Content-Type': 'application/json' } : {}),
            },
            body:
              operation === 'banks'
                ? undefined
                : multipart
                  ? input
                  : JSON.stringify(input),
          }
        );
        receivedResponse = true;
        const observe = (
          capture: OxygenObservedResponse['capture'],
          body?: unknown,
          failure?: OxygenObservedResponse['failure']
        ) =>
          deps.observe?.({
            operation,
            httpStatus: response.status,
            requestId:
              response.headers.get('x-request-id') ??
              response.headers.get('request-id'),
            capture,
            durationMs: Date.now() - startedAt,
            body,
            ...(failure ? { failure } : {}),
          });
        if (!response.ok) {
          let details: string[] = [];
          const diagnostic = await readOxygenFailureDiagnostic(
            response,
            operation,
            input,
            [token, ...(deps.redactionSecrets ?? [])],
            startedAt,
            (captured) => {
              details = captured;
            }
          );
          await observe(
            diagnostic.capture === 'parsed'
              ? 'parsed'
              : diagnostic.capture === 'non_json'
                ? 'non_json'
                : diagnostic.capture === 'oversized'
                  ? 'oversized'
                  : 'unavailable',
            undefined,
            {
              providerMessage: diagnostic.providerMessage,
              providerCode: diagnostic.providerCode,
              details,
            }
          );
          const statementRequired =
            operation === 'book' &&
            diagnostic.providerMessage ===
              'User does not have a valid statement and user has option to add another bank';
          const activeLoan =
            operation === 'book' &&
            diagnostic.httpStatus === 400 &&
            diagnostic.outcome === 'rejected' &&
            diagnostic.providerMessage === 'User has an active loan';
          const invalidOtp =
            (operation === 'validate_existing' ||
              operation === 'validate_new') &&
            diagnostic.httpStatus === 400 &&
            diagnostic.outcome === 'rejected' &&
            diagnostic.providerMessage ===
              'OTP validation failed. Please try again';
          throw new OxygenProviderFailure(
            diagnostic.outcome,
            activeLoan
              ? oxygenActiveLoanCode
              : statementRequired
                ? oxygenStatementRequiredCode
                : invalidOtp
                  ? oxygenInvalidOtpCode
                  : undefined,
            diagnostic
          );
        }
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        if (!reader) {
          await observe('unavailable');
          throw new Error('Missing body');
        }
        while (true) {
          let next: ReadableStreamReadResult<Uint8Array>;
          try {
            next = await reader.read();
          } catch (error) {
            await observe('unavailable');
            throw error;
          }
          if (next.done) break;
          size += next.value.byteLength;
          if (size > 2_097_152) {
            await reader.cancel();
            await observe('oversized');
            throw new Error('Too large');
          }
          chunks.push(next.value);
        }
        let raw: unknown;
        try {
          raw = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
        } catch {
          await observe('non_json');
          throw new Error('Invalid response');
        }
        await observe('parsed', raw);
        return raw;
      } catch (error) {
        if (error instanceof OxygenProviderFailure) throw error;
        throw new OxygenProviderFailure(
          'indeterminate',
          undefined,
          oxygenDiagnostic(
            operation,
            receivedResponse ? 'invalid_response' : 'transport',
            'indeterminate',
            startedAt
          )
        );
      }
    },
  };
}
