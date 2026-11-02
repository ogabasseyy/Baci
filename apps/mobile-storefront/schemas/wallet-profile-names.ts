import { z } from 'zod';

export const WalletProfileNamesSchema = z
  .object({
    first_name: z.string().trim().min(1, 'Enter your first name.').max(100),
    last_name: z.string().trim().min(1, 'Enter your last name.').max(100),
  })
  .refine((names) => `${names.first_name} ${names.last_name}`.length <= 200, {
    message: 'Your full name must be 200 characters or fewer.',
  });
