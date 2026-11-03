import type { NextRequest } from 'next/server';
import { resetWalletPin } from '@/lib/wallet-pin/wallet-pin-operations';
import { handleWalletPinMutation } from '@/lib/wallet-pin/wallet-pin-route';
import { walletPinSchemas } from '@/schemas/wallet-pin';

export function POST(request: NextRequest) {
  return handleWalletPinMutation(
    request,
    walletPinSchemas.resetRequest,
    (context, input) => resetWalletPin({ ...context, pin: input.pin })
  );
}
