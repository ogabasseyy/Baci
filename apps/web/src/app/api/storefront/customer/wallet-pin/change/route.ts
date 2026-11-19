import type { NextRequest } from 'next/server';
import { changeWalletPin } from '@/lib/wallet-pin/wallet-pin-operations';
import { handleWalletPinMutation } from '@/lib/wallet-pin/wallet-pin-route';
import { walletPinSchemas } from '@/schemas/wallet-pin';

export function POST(request: NextRequest) {
  return handleWalletPinMutation(
    request,
    walletPinSchemas.changeRequest,
    (context, input) =>
      changeWalletPin({
        ...context,
        currentPin: input.currentPin,
        newPin: input.newPin,
      }),
    'change'
  );
}
