import {
  buildCustomerAddressLine,
  buildCustomerRecordNameFields,
  CUSTOMER_ADMIN_COLUMNS,
} from '@baci/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { sanitizeEmail, sanitizePhone } from '@/lib/sanitize';
import { supabase } from '@/lib/supabase';
import { useMerchant } from './useMerchant';

const DUPLICATE_CUSTOMER_MESSAGE =
  'Customer with this email or phone already exists';
const DUPLICATE_CUSTOMER_CONSTRAINTS = [
  'customers_merchant_id_email_key',
  'customers_merchant_email_unique',
  'idx_customers_merchant_email',
  'customers_merchant_phone_unique',
] as const;

function escapeIlikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function isDuplicateCustomerConstraintError(
  error: { message?: string | null } | null
): boolean {
  const message = error?.message ?? '';

  return DUPLICATE_CUSTOMER_CONSTRAINTS.some((constraint) =>
    message.includes(constraint)
  );
}

export function useCreateCustomer() {
  const { merchant } = useMerchant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['createCustomer'],
    mutationFn: async (newCustomer: {
      company_name?: string;
      customer_type?: 'individual' | 'company';
      first_name: string;
      last_name: string;
      email?: string;
      phone?: string;
      address?: string;
      city?: string;
      state?: string;
      zip_code?: string;
      country?: string;
      country_code?: string;
      latitude?: number;
      longitude?: number;
    }) => {
      if (!merchant?.id) throw new Error('No merchant selected');

      const normalizedEmail = newCustomer.email
        ? sanitizeEmail(newCustomer.email)
        : '';
      const normalizedPhone = newCustomer.phone
        ? sanitizePhone(newCustomer.phone)
        : '';

      if (normalizedPhone) {
        const { data: existingPhoneCustomer, error: phoneLookupError } =
          await supabase
            .from('customers')
            .select('id')
            .eq('merchant_id', merchant.id)
            .is('deleted_at', null)
            .eq('phone', normalizedPhone)
            .limit(1);

        if (phoneLookupError) throw new Error(phoneLookupError.message);
        if (existingPhoneCustomer?.[0])
          throw new Error(DUPLICATE_CUSTOMER_MESSAGE);
      }

      if (normalizedEmail) {
        const { data: existingEmailCustomer, error: emailLookupError } =
          await supabase
            .from('customers')
            .select('id')
            .eq('merchant_id', merchant.id)
            .is('deleted_at', null)
            .ilike('email', escapeIlikePattern(normalizedEmail))
            .limit(1);

        if (emailLookupError) throw new Error(emailLookupError.message);
        if (existingEmailCustomer?.[0])
          throw new Error(DUPLICATE_CUSTOMER_MESSAGE);
      }

      const nameFields = buildCustomerRecordNameFields({
        company_name: newCustomer.company_name,
        customer_type: newCustomer.customer_type ?? 'individual',
        first_name: newCustomer.first_name,
        last_name: newCustomer.last_name,
        email: normalizedEmail || undefined,
      });
      const address =
        newCustomer.address?.trim() ||
        buildCustomerAddressLine(
          newCustomer.city,
          newCustomer.state,
          newCustomer.zip_code
        );

      const { data, error } = await supabase
        .from('customers')
        .insert({
          merchant_id: merchant.id,
          ...nameFields,
          email: normalizedEmail || null,
          phone: normalizedPhone || null,
          address,
          city: newCustomer.city?.trim() || null,
          state: newCustomer.state?.trim() || null,
          zip_code: newCustomer.zip_code?.trim() || null,
          country: newCustomer.country?.trim() || null,
          country_code: newCustomer.country_code?.trim() || null,
          latitude:
            typeof newCustomer.latitude === 'number' &&
            Number.isFinite(newCustomer.latitude)
              ? newCustomer.latitude
              : null,
          longitude:
            typeof newCustomer.longitude === 'number' &&
            Number.isFinite(newCustomer.longitude)
              ? newCustomer.longitude
              : null,
          store_credit: 0,
          total_orders: 0,
          total_spent: 0,
          loyalty_points: 0,
        })
        .select(CUSTOMER_ADMIN_COLUMNS)
        .single();

      if (error) {
        if (isDuplicateCustomerConstraintError(error)) {
          throw new Error(DUPLICATE_CUSTOMER_MESSAGE);
        }
        throw new Error(error.message);
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customer-stats'] });
    },
  });
}
