import type { AuthResult } from '@/lib/api-auth';
import { verifiedCartCustomerRowSchema } from '@/schemas/cart-account';
import type { CartPrincipal } from './principal';

const verifiedCustomer = Symbol('VerifiedCartCustomer');
export interface VerifiedCartCustomer {
  readonly [verifiedCustomer]: true;
  userId: string;
  customerId: string;
  merchantId: string;
}
export async function verifyCartCustomer(
  principal: CartPrincipal,
  auth: Pick<AuthResult, 'user' | 'supabase' | 'error'>
): Promise<
  | { ok: true; customer: VerifiedCartCustomer }
  | { ok: false; code: 'unauthorized' | 'temporarily_unavailable' }
> {
  if (auth.error || !auth.user || !auth.supabase)
    return { ok: false, code: 'unauthorized' };
  try {
    const { data, error } = await auth.supabase
      .from('customers')
      .select('id, merchant_id, user_id')
      .eq('merchant_id', principal.merchantId)
      .eq('user_id', auth.user.id)
      .maybeSingle();
    if (error) return { ok: false, code: 'temporarily_unavailable' };
    const parsed = verifiedCartCustomerRowSchema.safeParse(data);
    if (
      !parsed.success ||
      parsed.data.merchant_id !== principal.merchantId ||
      parsed.data.user_id !== auth.user.id
    )
      return { ok: false, code: 'unauthorized' };
    return {
      ok: true,
      customer: {
        [verifiedCustomer]: true,
        merchantId: parsed.data.merchant_id,
        userId: parsed.data.user_id,
        customerId: parsed.data.id,
      },
    };
  } catch {
    return { ok: false, code: 'temporarily_unavailable' };
  }
}
