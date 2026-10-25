import { z } from 'zod';
import { oxygenProbeCustomerSchema } from './oxygen-probe';

const field = z.string().trim().min(1).max(200);
const action = <T extends string>(value: T) =>
  z.object({ action: z.literal(value) }).strict();
export const oxygenRuntimeActionSchema = z.discriminatedUnion('action', [
  action('refresh_eligibility'),
  action('refresh_kyc'),
  action('resend_customer_otp'),
  action('validate_nin'),
  action('selfie_link'),
  action('refresh_payment_setup'),
  action('cancel_booking'),
  action('refresh_details'),
  action('trigger_approval_otp'),
  z
    .object({
      action: z.literal('start_application'),
      customer: oxygenProbeCustomerSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('validate_customer'),
      otp: z.string().regex(/^\d{4,8}$/),
    })
    .strict(),
  z
    .object({
      action: z.literal('book'),
      equityPercentage: z
        .number()
        .min(25)
        .max(90)
        .refine((n) => /^\d+(?:\.\d{1,2})?$/.test(String(n))),
      tenure: z.number().int().min(1).max(12),
    })
    .strict(),
  z
    .object({
      action: z.literal('submit_address'),
      state: field,
      lga: field,
      city: field,
      street: field,
      landmark: field,
      house_number: field,
    })
    .strict(),
  z
    .object({
      action: z.literal('approve_booking'),
      otp: z.string().regex(/^\d{4,8}$/),
      accepted: z.literal(true),
    })
    .strict(),
]);
export type OxygenRuntimeAction = z.infer<typeof oxygenRuntimeActionSchema>;
export const oxygenRuntimeSubmissionSchema = z
  .object({
    workflowId: z.uuid(),
    version: z.number().int().nonnegative(),
    idempotencyKey: z.uuid(),
    command: oxygenRuntimeActionSchema,
  })
  .strict();
const status = z.enum(['DONE', 'NOT_DONE', 'PROCESSING']);
export const oxygenKycSchema = z.object({
  bvn_status: status,
  nin_status: status,
  bank_status: status,
  phone_status: status,
  selfie_status: status,
  address_status: status,
});
const amount = z
  .number()
  .finite()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER / 100);
export const oxygenBookingSchema = z.object({
  loan_reference: z.uuid(),
  product_amount: amount,
  loan_amount: amount,
  equity_percentage: z.number(),
  equity_amount: amount,
  loan_tenure: z.number().int().positive(),
  status: z.enum(['BOOKED', 'APPROVED']),
  total_charges: amount.nullish(),
  total_upfront_payment: amount.nullish(),
  first_repayment: amount.nullish(),
});
export const oxygenProviderStateSchema = z
  .object({
    applicationReference: z.uuid().optional(),
    bookingReference: z.uuid().optional(),
    phone: z
      .string()
      .regex(/^234\d{10}$/)
      .optional(),
    customerPath: z.enum(['new', 'existing']).optional(),
    newUserToken: z.string().max(16384).optional(),
    activityToken: z.string().max(16384).optional(),
    validated: z.boolean().optional(),
    eligible: z.boolean().optional(),
    eligibilityStatus: z.enum(['pending', 'failed', 'completed']).optional(),
    eligibleAmount: amount.optional(),
    minimumAmount: amount.optional(),
    maxTenure: z.number().int().positive().optional(),
    schedule: z
      .array(
        z.object({
          period: z.number().int().positive(),
          dueDate: z.tuple([
            z.number().int(),
            z.number().int(),
            z.number().int(),
          ]),
          amount: amount,
          principal: amount,
          interest: amount,
        })
      )
      .max(120)
      .optional(),
    quotedCharges: amount.optional(),
    kyc: oxygenKycSchema.optional(),
    booking: oxygenBookingSchema.optional(),
    paymentComplete: z.boolean().optional(),
    setupComplete: z.boolean().optional(),
    paymentUrl: z.string().optional(),
    setupUrl: z.string().optional(),
    selfieUrl: z.string().optional(),
  })
  .strict();
export type OxygenProviderState = z.infer<typeof oxygenProviderStateSchema>;
export const oxygenProviderContextSchema = z
  .object({
    workflowId: z.uuid(),
    stage: z.string(),
    version: z.number().int(),
    environment: z.literal('staging'),
    partnerReference: field,
    merchantReference: field.nullable(),
    bookingBlock: z.literal('active_loan').nullable().optional(),
    orderId: z.uuid(),
    productAmount: amount.positive(),
    orderPhone: z.string(),
    productName: field,
    address: z.string().max(1000).default(''),
    state: oxygenProviderStateSchema,
  })
  .strict();
export type OxygenProviderContext = z.infer<typeof oxygenProviderContextSchema>;
export interface OxygenTransientFile {
  bytes: Uint8Array;
  type: string;
  name: string;
}
/** Application upload limit, not a claim about Oxygen's maximum. */
export function validateOxygenFile(
  bytes: Uint8Array,
  type: string,
  name: string
): boolean {
  if (
    bytes.length === 0 ||
    bytes.length > 1_572_864 ||
    !/^[-\w .]{1,120}$/.test(name)
  )
    return false;
  const starts = (prefix: number[]) => prefix.every((v, i) => bytes[i] === v);
  return (
    (type === 'application/pdf' &&
      /\.pdf$/i.test(name) &&
      starts([37, 80, 68, 70, 45])) ||
    (type === 'image/jpeg' &&
      /\.jpe?g$/i.test(name) &&
      starts([255, 216, 255])) ||
    (type === 'image/png' &&
      /\.png$/i.test(name) &&
      starts([137, 80, 78, 71, 13, 10, 26, 10]))
  );
}
