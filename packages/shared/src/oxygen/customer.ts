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
