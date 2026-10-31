import { type NextRequest, NextResponse } from 'next/server';
import {
  authenticateApiRequest,
  getUserAccess,
  hasPermission,
} from '@/lib/api-auth';
import { readMerchantShippingWalletBalance } from '@/lib/shipping/merchant-shipping-wallet-balance';

// GIG shipping wallet poll: the owner and orders.fulfill staff see only the
// available balance needed to know whether a booking is covered.
export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (!auth.user || !auth.supabase)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const access = await getUserAccess(auth.supabase);
  if (!access?.merchantId || !hasPermission(access, 'orders', 'fulfill'))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const wallet = await readMerchantShippingWalletBalance(
    auth.supabase,
    access.merchantId
  );
  if (!wallet.ok)
    return NextResponse.json(
      { error: 'Unable to load wallet' },
      { status: 500 }
    );
  return NextResponse.json({
    availableBalance: wallet.availableBalance,
    currency: 'NGN',
  });
}
