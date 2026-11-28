import { z } from 'zod';

export const domainLifecycleStateSchema = z.enum([
  'provisioning',
  'pending_verification',
  'verifying_routing',
  'active',
  'deleting',
  'deleting_reconciling',
]);

export type DomainLifecycleState = z.infer<typeof domainLifecycleStateSchema>;

export const providerCreateStateSchema = z.enum([
  'none',
  'in_flight',
  'indeterminate',
  'confirmed',
  'deleted',
]);

export type ProviderCreateState = z.infer<typeof providerCreateStateSchema>;

export const domainVerificationRecordSchema = z.object({
  name: z.string().min(1),
  purpose: z.enum([
    'routing',
    'cloudflare_ownership',
    'cloudflare_ssl_dcv',
    'vercel_ownership',
  ]),
  status: z.enum(['pending', 'verified', 'failed']),
  type: z.enum(['CNAME', 'TXT', 'A']),
  value: z.string().min(1),
});

export type DomainVerificationRecord = z.infer<
  typeof domainVerificationRecordSchema
>;

export const cloudflareValidationRecordSchema = z.object({
  txt_name: z.string().min(1).optional(),
  txt_value: z.string().min(1).optional(),
});

export const cloudflareCustomHostnameSchema = z.object({
  id: z.string().min(1),
  hostname: z.string().min(1),
  status: z.string().min(1),
  ownership_verification: z
    .object({
      name: z.string().min(1).optional(),
      type: z.string().min(1).optional(),
      value: z.string().min(1).optional(),
    })
    .optional(),
  ssl: z
    .object({
      status: z.string().min(1).optional(),
      validation_records: z.array(cloudflareValidationRecordSchema).optional(),
    })
    .optional(),
});

export type CloudflareCustomHostname = z.infer<
  typeof cloudflareCustomHostnameSchema
>;

export const cloudflareSingleEnvelopeSchema = z.object({
  success: z.boolean(),
  result: cloudflareCustomHostnameSchema.nullable().optional(),
  errors: z
    .array(z.object({ code: z.number(), message: z.string() }))
    .optional(),
});

export const cloudflareListEnvelopeSchema = z.object({
  success: z.boolean(),
  result: z.array(cloudflareCustomHostnameSchema).optional(),
  errors: z
    .array(z.object({ code: z.number(), message: z.string() }))
    .optional(),
});

export const cloudflareDeleteEnvelopeSchema = z.object({
  success: z.boolean(),
  result: z
    .object({ id: z.string().min(1) })
    .nullable()
    .optional(),
  errors: z
    .array(z.object({ code: z.number(), message: z.string() }))
    .optional(),
});
