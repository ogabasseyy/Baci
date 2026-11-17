import type { User } from '@supabase/supabase-js';
import type { createClient } from '@/lib/supabase/server';

const CUSTOMER_SESSION_SELECT = `
  id,
  first_name,
  last_name,
  email,
  phone,
  address,
  date_of_birth,
  saved_addresses,
  store_credit,
  total_orders,
  total_spent,
  created_at
`;

function normalizeProfileString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

function getCustomerProfileFields(
  metadata: Record<string, unknown> | null | undefined,
  authPhone?: unknown
) {
  const explicitFirstName = normalizeProfileString(metadata?.first_name);
  const explicitLastName = normalizeProfileString(metadata?.last_name);
  const explicitFullName = normalizeProfileString(metadata?.full_name);
  const fullNameParts = explicitFullName?.split(/\s+/) ?? [];
  const firstName = explicitFirstName ?? fullNameParts[0] ?? null;
  const lastName =
    explicitLastName ??
    (fullNameParts.length > 1 ? fullNameParts.slice(1).join(' ') : null);
  const fullName =
    explicitFullName ??
    ([firstName, lastName].filter(Boolean).join(' ') || null);

  return {
    firstName,
    fullName,
    lastName,
    phone:
      normalizeProfileString(authPhone) ??
      normalizeProfileString(metadata?.phone),
  };
}

export async function reconcileStorefrontCustomer(
  supabase: ReturnType<typeof createClient>,
  merchantId: string,
  user: User
) {
  let { data: customer, error: customerError } = await supabase
    .from('customers')
    .select(CUSTOMER_SESSION_SELECT)
    .eq('merchant_id', merchantId)
    .eq('user_id', user.id)
    .single();

  if (customerError && customerError.code !== 'PGRST116') {
    console.error('Customer fetch error:', customerError);
    return customer;
  }

  if (customer) {
    return customer;
  }

  const authPhone = normalizeProfileString(
    'phone' in user ? user.phone : undefined
  );
  const profileFields = getCustomerProfileFields(user.user_metadata, authPhone);
  const userEmail = normalizeProfileString(user.email);
  let shouldCreateNoEmailCustomer = !authPhone;

  if (!userEmail && authPhone) {
    const { data: claimedCustomerId, error: claimError } = await supabase.rpc(
      'claim_customer_on_phone_auth',
      {
        p_first_name: profileFields.firstName,
        p_last_name: profileFields.lastName,
        p_merchant_id: merchantId,
        p_phone: authPhone,
        p_user_id: user.id,
      }
    );

    if (claimError) {
      console.error('Failed to claim no-email customer session:', claimError);
      shouldCreateNoEmailCustomer = true;
    } else if (!claimedCustomerId) {
      console.error('Phone auth customer claim returned no customer id', {
        merchantId,
        userId: user.id,
      });
      shouldCreateNoEmailCustomer = true;
    } else {
      const { data: claimedCustomer, error: claimedCustomerError } =
        await supabase
          .from('customers')
          .select(CUSTOMER_SESSION_SELECT)
          .eq('id', claimedCustomerId)
          .eq('merchant_id', merchantId)
          .eq('user_id', user.id)
          .single();

      if (claimedCustomerError) {
        console.error(
          'Customer fetch after phone claim error:',
          claimedCustomerError
        );
      } else {
        customer = claimedCustomer;
      }
    }
  }

  if (!userEmail && shouldCreateNoEmailCustomer) {
    const { data: newCustomer, error: createError } = await supabase
      .from('customers')
      .insert({
        email: null,
        first_name: profileFields.firstName,
        last_name: profileFields.lastName,
        merchant_id: merchantId,
        phone: profileFields.phone,
        user_id: user.id,
      })
      .select(CUSTOMER_SESSION_SELECT)
      .single();

    if (createError) {
      console.error('Failed to create no-email customer session:', createError);
    } else {
      customer = newCustomer;
    }
  } else if (userEmail) {
    const { error: upsertError } = await supabase.rpc(
      'upsert_customer_on_auth',
      {
        p_merchant_id: merchantId,
        p_user_id: user.id,
        p_email: userEmail,
        p_full_name: profileFields.fullName,
        p_phone: profileFields.phone,
      }
    );

    if (upsertError) {
      console.error('Failed to upsert customer session:', upsertError);
      return customer;
    }

    const { data: linkedCustomer, error: linkedCustomerError } = await supabase
      .from('customers')
      .select(CUSTOMER_SESSION_SELECT)
      .eq('merchant_id', merchantId)
      .eq('user_id', user.id)
      .single();

    if (linkedCustomerError && linkedCustomerError.code !== 'PGRST116') {
      console.error('Customer fetch after upsert error:', linkedCustomerError);
    } else if (linkedCustomerError?.code === 'PGRST116') {
      console.error('Customer fetch after upsert returned no rows', {
        error: linkedCustomerError,
        merchantId,
        userId: user.id,
      });
    }

    customer = linkedCustomer;

    const profileNameUpdates: {
      first_name?: string;
      last_name?: string;
    } = {};

    if (!customer?.first_name && profileFields.firstName) {
      profileNameUpdates.first_name = profileFields.firstName;
    }
    if (!customer?.last_name && profileFields.lastName) {
      profileNameUpdates.last_name = profileFields.lastName;
    }

    if (customer && Object.keys(profileNameUpdates).length > 0) {
      const { data: namedCustomer, error: nameUpdateError } = await supabase
        .from('customers')
        .update(profileNameUpdates)
        .eq('id', customer.id)
        .eq('merchant_id', merchantId)
        .eq('user_id', user.id)
        .select(CUSTOMER_SESSION_SELECT)
        .single();

      if (nameUpdateError) {
        console.error('Customer profile name update error:', nameUpdateError);
      } else {
        customer = namedCustomer;
      }
    }
  }

  return customer;
}
