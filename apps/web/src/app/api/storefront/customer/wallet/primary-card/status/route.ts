import type { NextRequest } from 'next/server';
import { handlePrimaryWalletCardCheckout } from '../primary-wallet-card-checkout-route';

export function POST(request: NextRequest) {
  return handlePrimaryWalletCardCheckout(request, 'status');
}
