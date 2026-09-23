import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (!auth.user || !auth.supabase)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: merchant, error } = await auth.supabase
    .from('merchants')
    .select('id')
    .eq('user_id', auth.user.id)
    .maybeSingle();
  if (error)
    return NextResponse.json(
      { error: 'Unable to load merchant' },
      { status: 500 }
    );
  if (!merchant)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { data: wallet, error: walletError } = await auth.supabase.rpc(
    'get_wallet_summary',
    { p_merchant_id: merchant.id }
  );
  if (walletError)
    return NextResponse.json(
      { error: 'Unable to load wallet' },
      { status: 500 }
    );
  const row = Array.isArray(wallet) ? wallet[0] : wallet;
  return NextResponse.json({
    availableBalance: Number(row?.available_balance ?? 0),
    currency: 'NGN',
  });
}
