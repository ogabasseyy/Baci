import type { NextRequest } from 'next/server';
import { handleWalletPinStatus } from '@/lib/wallet-pin/wallet-pin-route';

export function GET(request: NextRequest) {
  return handleWalletPinStatus(request);
}
