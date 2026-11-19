import { z } from 'zod';

export const oxygenDiagnosticOperationSchema = z.enum([
  'banks',
  'name_enquiry',
  'create',
  'resend_existing',
  'resend_new',
  'validate_existing',
  'validate_new',
  'kyc',
  'nin',
  'selfie',
  'address',
  'eligibility',
  'book',
  'details',
  'cancel',
  'approval_otp',
  'approve',
  'payment',
  'upfront_link',
  'repayment_link',
]);
export const oxygenProviderDiagnosticSchema = z
  .object({
    operation: oxygenDiagnosticOperationSchema.nullable(),
    kind: z.enum([
      'http',
      'transport',
      'authentication',
      'invalid_response',
      'validation',
    ]),
    outcome: z.enum(['not_sent', 'rejected', 'indeterminate']),
    httpStatus: z.number().int().min(100).max(599).nullable(),
    providerCode: z.string().max(32).nullable(),
    providerMessage: z.string().max(1000).nullable(),
    providerRequestId: z.string().max(128).nullable(),
    capture: z.enum([
      'parsed',
      'non_json',
      'oversized',
      'unavailable',
      'not_applicable',
    ]),
    occurredAt: z.iso.datetime(),
    durationMs: z.number().int().min(0).max(300000),
  })
  .strict();
export type OxygenProviderDiagnostic = z.infer<
  typeof oxygenProviderDiagnosticSchema
>;
