import type { NextRequest } from 'next/server';
import { setWalletPin } from '@/lib/wallet-pin/wallet-pin-operations';
import { handleWalletPinMutation } from '@/lib/wallet-pin/wallet-pin-route';
import { walletPinSchemas } from '@/schemas/wallet-pin';

export function POST(request: NextRequest) {
  return handleWalletPinMutation(
    request,
    walletPinSchemas.setRequest,
    (context, input) => setWalletPin({ ...context, pin: input.pin })
  );
}
