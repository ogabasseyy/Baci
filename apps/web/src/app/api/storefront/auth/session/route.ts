import { isAuthSessionMissingError } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveStorefrontAuthMerchant } from '../resolve-storefront-auth-merchant';

/**
 * Customer Auth Session
 *
 * GET - Returns the current customer session and customer data
 */

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

// react-doctor-disable-next-line react-doctor/nextjs-no-side-effect-in-get-handler -- Storefront session hydration intentionally reconciles the signed-in customer; guarded by Supabase auth and merchant lookup.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const merchantSlug = searchParams.get('merchantSlug');

    if (!merchantSlug) {
      return NextResponse.json(
        { error: 'Merchant slug is required' },
        { status: 400 }
      );
    }

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    // Get current auth session
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError) {
      if (isAuthSessionMissingError(authError)) {
        return NextResponse.json({
          authenticated: false,
          user: null,
          customer: null,
        });
      }
      console.error('Storefront auth session lookup failed:', authError);
      return NextResponse.json(
        { error: 'Session lookup failed' },
        { status: 503 }
      );
    }

    if (!user) {
      return NextResponse.json({
        authenticated: false,
        user: null,
        customer: null,
      });
    }

    // Check if user is a customer (not a merchant)
    const userRole = user.user_metadata?.role;
    if (userRole === 'merchant') {
      // Merchants should not be treated as customers on storefront
      return NextResponse.json({
        authenticated: false,
        user: null,
        customer: null,
        reason: 'merchant_account',
      });
    }

    const merchant = await resolveStorefrontAuthMerchant(
      supabase,
      merchantSlug
    );

    if (!merchant) {
      return NextResponse.json({ error: 'Store not found' }, { status: 404 });
    }

    // Get customer record for this merchant
    let { data: customer, error: customerError } = await supabase
      .from('customers')
      .select(CUSTOMER_SESSION_SELECT)
      .eq('merchant_id', merchant.id)
      .eq('user_id', user.id)
      .single();

    if (customerError && customerError.code !== 'PGRST116') {
      // PGRST116 = no rows found (customer not yet created for this merchant)
      console.error('Customer fetch error:', customerError);
    } else if (!customer) {
      const authPhone = normalizeProfileString(
        'phone' in user ? user.phone : undefined
      );
      const profileFields = getCustomerProfileFields(
        user.user_metadata,
        authPhone
      );
      const userEmail = normalizeProfileString(user.email);
      let shouldCreateNoEmailCustomer = !authPhone;

      if (!userEmail && authPhone) {
        const { data: claimedCustomerId, error: claimError } =
          await supabase.rpc('claim_customer_on_phone_auth', {
            p_first_name: profileFields.firstName,
            p_last_name: profileFields.lastName,
            p_merchant_id: merchant.id,
            p_phone: authPhone,
            p_user_id: user.id,
          });

        if (claimError) {
          console.error(
            'Failed to claim no-email customer session:',
            claimError
          );
          shouldCreateNoEmailCustomer = true;
        } else if (!claimedCustomerId) {
          console.error('Phone auth customer claim returned no customer id', {
            merchantId: merchant.id,
            userId: user.id,
          });
          shouldCreateNoEmailCustomer = true;
        } else {
          const { data: claimedCustomer, error: claimedCustomerError } =
            await supabase
              .from('customers')
              .select(CUSTOMER_SESSION_SELECT)
              .eq('id', claimedCustomerId)
              .eq('merchant_id', merchant.id)
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
            merchant_id: merchant.id,
            phone: profileFields.phone,
            user_id: user.id,
          })
          .select(CUSTOMER_SESSION_SELECT)
          .single();

        if (createError) {
          console.error(
            'Failed to create no-email customer session:',
            createError
          );
        } else {
          customer = newCustomer;
        }
      } else if (userEmail) {
        const { error: upsertError } = await supabase.rpc(
          'upsert_customer_on_auth',
          {
            p_merchant_id: merchant.id,
            p_user_id: user.id,
            p_email: userEmail,
            p_full_name: profileFields.fullName,
            p_phone: profileFields.phone,
          }
        );

        if (upsertError) {
          console.error('Failed to upsert customer session:', upsertError);
        } else {
          const { data: linkedCustomer, error: linkedCustomerError } =
            await supabase
              .from('customers')
              .select(CUSTOMER_SESSION_SELECT)
              .eq('merchant_id', merchant.id)
              .eq('user_id', user.id)
              .single();

          if (linkedCustomerError && linkedCustomerError.code !== 'PGRST116') {
            console.error(
              'Customer fetch after upsert error:',
              linkedCustomerError
            );
          } else if (linkedCustomerError?.code === 'PGRST116') {
            console.error('Customer fetch after upsert returned no rows', {
              error: linkedCustomerError,
              merchantId: merchant.id,
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
            const { data: namedCustomer, error: nameUpdateError } =
              await supabase
                .from('customers')
                .update(profileNameUpdates)
                .eq('id', customer.id)
                .eq('merchant_id', merchant.id)
                .eq('user_id', user.id)
                .select(CUSTOMER_SESSION_SELECT)
                .single();

            if (nameUpdateError) {
              console.error(
                'Customer profile name update error:',
                nameUpdateError
              );
            } else {
              customer = namedCustomer;
            }
          }
        }
      }
    }

    return NextResponse.json({
      authenticated: true,
      user: {
        id: user.id,
        email: normalizeProfileString(user.email),
        role: userRole || 'customer',
      },
      customer: customer || null,
    });
  } catch (error) {
    console.error('Session check error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
