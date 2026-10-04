import type { SupabaseClient, User } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { customerSavingsNonpaymentSchemas as schemas } from '@/schemas/customer-savings-nonpayment';
import { resolveWalletTopUpMerchant } from './resolve-wallet-top-up-merchant';

export async function resolveCustomerSavingsNonpaymentContext({
  identifiers,
  supabase,
  user,
}: {
  identifiers: unknown;
  supabase: SupabaseClient;
  user: Pick<User, 'id'>;
}): Promise<
  | { response: NextResponse }
  | {
      customer: { id: string; merchant_id: string; user_id: string };
      merchant: { id: string; slug: string | null };
      supabase: SupabaseClient;
    }
> {
  const actor = schemas.actorId.safeParse(user?.id);
  if (!actor.success) {
    return {
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }
  const input = schemas.identifiers.safeParse(identifiers);
  if (!input.success) {
    return {
      response: NextResponse.json({ error: 'Invalid input' }, { status: 400 }),
    };
  }
  try {
    const identity = await resolveWalletTopUpMerchant<unknown>(
      supabase,
      input.data,
      'id, slug'
    );
    if (!identity) {
      return {
        response: NextResponse.json(
          { error: 'Merchant not found' },
          { status: 404 }
        ),
      };
    }
    const merchant = schemas.merchant.parse(identity);
    const { data, error } = await supabase
      .from('customers')
      .select('id, merchant_id, user_id')
      .eq('user_id', actor.data)
      .eq('merchant_id', merchant.id)
      .maybeSingle();
    if (error) throw new Error('Customer lookup failed');
    if (!data) {
      return {
        response: NextResponse.json(
          { error: 'Customer not found' },
          { status: 404 }
        ),
      };
    }
    const customer = schemas.customer.safeParse(data);
    if (
      !customer.success ||
      customer.data.user_id !== actor.data ||
      customer.data.merchant_id !== merchant.id
    ) {
      return {
        response: NextResponse.json(
          { error: 'Customer not found' },
          { status: 404 }
        ),
      };
    }
    return { customer: customer.data, merchant, supabase };
  } catch {
    return {
      response: NextResponse.json(
        { error: 'Unable to resolve savings context' },
        { status: 500 }
      ),
    };
  }
}
