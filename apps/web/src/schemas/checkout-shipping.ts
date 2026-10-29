import { isValidPhoneNumber } from 'react-phone-number-input';
import z from 'zod';

export const checkoutShippingSchema = z.object({
  firstName: z
    .string()
    .min(2, { message: 'First name must be at least 2 characters.' }),
  lastName: z
    .string()
    .min(2, { message: 'Last name must be at least 2 characters.' }),
  email: z.email({ error: 'Please enter a valid email address.' }),
  phone: z.string().refine(isValidPhoneNumber, {
    message: 'Please enter a valid phone number.',
  }),
  address: z.string().min(5, { message: 'Please enter a valid address.' }),
  city: z.string().min(2, { message: 'Please enter a city.' }),
  state: z.string().min(2, { message: 'Please enter a state.' }),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
});

export type ShippingFormValues = z.infer<typeof checkoutShippingSchema>;
