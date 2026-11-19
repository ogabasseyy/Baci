import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { checkCsrfProtection } from '@/lib/csrf';
import { resolveMerchantIdBySlugOrAlias } from '@/lib/resolve-merchant-by-slug';
import { createClient } from '@/lib/supabase/server';
import { customerProfilePatchSchema } from '@/schemas/customer-profile-patch';

/**
 * Customer Profile API
 *
 * PATCH - Update customer profile
 */

export async function PATCH(request: NextRequest) {
  try {
    // 1. Auth check FIRST
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. CSRF: this route is cookie-authenticated (web shoppers), so a valid
    // double-submit token is required on this PATCH — matching the other
    // cookie-auth storefront mutations (e.g. receipt-claim routes). Bearer-token
    // callers (mobile) are skipped inside checkCsrfProtection; the mobile app
    // does not use this endpoint (it writes DOB via the set_customer_date_of_birth
    // RPC), so cookie CSRF here does not affect it.
    const csrf = await checkCsrfProtection(request);
    if (!csrf.valid) {
      return (
        csrf.response ??
        NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 })
      );
    }

    // 3. Parse and validate body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const parseResult = customerProfilePatchSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: z.flattenError(parseResult.error) },
        { status: 400 }
      );
    }

    const {
      merchantSlug,
      first_name,
      last_name,
      phone,
      date_of_birth,
      saved_addresses,
      expected_user_id,
    } = parseResult.data;

    // Bind the write to the shopper the caller intended: if the cookie session
    // switched to a different user after the form was captured, reject rather
    // than writing this data onto the new account.
    if (expected_user_id !== undefined && expected_user_id !== user.id) {
      return NextResponse.json(
        {
          error: 'Your session changed. Please try again.',
          code: 'session_changed',
        },
        { status: 409 }
      );
    }

    // 3. Get merchant (alias-aware: a stale client on a just-renamed store passes
    // the retired slug in the body, which the proxy can't rewrite — resolve it via
    // the alias table so the request still targets the current merchant).
    const { merchantId, error: merchantError } =
      await resolveMerchantIdBySlugOrAlias(supabase, merchantSlug);

    if (merchantError || !merchantId) {
      return NextResponse.json({ error: 'Store not found' }, { status: 404 });
    }

    // Get customer record for this merchant — live rows only. A soft-deleted
    // account (deleted_at set) must not be writable: the mobile RPC and
    // start_quiz_attempt both exclude deleted customers, so resurrecting one
    // here would let the quiz gate close on a row the server then rejects.
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('id')
      .eq('merchant_id', merchantId)
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .single();

    if (customerError || !customer) {
      return NextResponse.json(
        { error: 'Customer not found' },
        { status: 404 }
      );
    }

    // Build update object with only provided fields
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (first_name !== undefined) {
      updateData.first_name = first_name;
    }

    if (last_name !== undefined) {
      updateData.last_name = last_name;
    }

    if (phone !== undefined) {
      updateData.phone = phone;
    }

    if (date_of_birth !== undefined) {
      updateData.date_of_birth = date_of_birth;
    }

    if (saved_addresses !== undefined) {
      updateData.saved_addresses = saved_addresses;
    }

    // Update customer. Reassert `deleted_at IS NULL` on the write itself: the
    // row could be soft-deleted between the lookup above and here, and .select()
    // lets us confirm a live row actually matched instead of reporting a false
    // success on zero affected rows.
    const { data: updated, error: updateError } = await supabase
      .from('customers')
      .update(updateData)
      .eq('id', customer.id)
      .eq('merchant_id', merchantId)
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle();

    if (updateError) {
      console.error('Customer update error:', updateError);
      return NextResponse.json(
        { error: 'Failed to update profile' },
        { status: 500 }
      );
    }

    if (!updated) {
      // No live row matched — the account was soft-deleted between the lookup
      // and the update. Report not-found rather than a phantom success.
      return NextResponse.json(
        { error: 'Customer not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Profile updated successfully',
    });
  } catch (error) {
    console.error('Customer update API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
