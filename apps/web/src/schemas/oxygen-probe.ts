import { z } from 'zod';
// Manual probe mirrors published fields, not an asserted required-field matrix.
export const oxygenProbeCustomerSchema = z.object({
  accept_terms_and_condition: z.literal('yes'),
  user_category: z.literal('individual'),
  customer_personal_details: z.object({
    external_identifier: z.string().max(100),
    first_name: z.string().min(1).max(100),
    last_name: z.string().min(1).max(100),
    middle_name: z.string().max(100),
    phone_number: z.string().regex(/^234\d{10}$/),
    email: z.email(),
    bvn: z.string().regex(/^\d{11}$/),
    nin: z.string().regex(/^\d{11}$/),
    date_of_birth: z.iso.date(),
  }),
  customer_bank_details: z.object({
    bank_code: z.string().min(1).max(20),
    bank_name: z.string().min(1).max(100),
    account_number: z.string().regex(/^\d{10}$/),
    account_name: z.string().min(1).max(150),
  }),
  customer_employment_details: z.object({
    employment_status: z.enum([
      'EMPLOYED',
      'PENSIONER',
      'SELF_EMPLOYED',
      'UNEMPLOYED',
    ]),
    name_of_employer: z.string().max(150),
    salary_amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
    salary_date: z.number().int().min(1).max(31),
  }),
});
export const oxygenProbeOtpSchema = z.object({
  otp: z.string().regex(/^\d{4,8}$/),
  token: z.string().max(16384).optional(),
});

export const oxygenProbeNameEnquirySchema = z.object({
  bank_code: z.string().regex(/^\d{3,10}$/),
  account_number: z.string().regex(/^\d{10}$/),
  phone_number: z.string().regex(/^234\d{10}$/),
});

export const oxygenProbeResumeSchema = z.object({
  reference: z.string().min(1).max(199),
  phone: z.string().regex(/^234\d{10}$/),
  newUserToken: z.string().max(16384),
  token: z.string().max(16384),
  expiresAt: z.number().finite().min(0),
  customerPath: z.enum(['new', 'existing', 'unknown']),
});

export const oxygenProbeCheckpointSchema = z
  .object({
    reference: z.string().max(199),
    phone: z.union([z.literal(''), z.string().regex(/^234\d{10}$/)]),
    newUserToken: z.string().max(16384),
    customerPath: z.enum(['new', 'existing', 'unknown']),
    createLocked: z.boolean(),
    retryAvailable: z.boolean(),
  })
  .strict()
  .refine(
    (state) =>
      (!state.reference ||
        (state.createLocked &&
          Boolean(state.phone) &&
          !state.retryAvailable)) &&
      (!state.retryAvailable || (state.createLocked && !state.reference))
  );
