import type { CreateVirtualAccountParams } from './chat-tools';

export interface VirtualAccountResult {
  success: boolean;
  orderId?: string;
  accountNumber?: string;
  bankName?: string;
  accountName?: string;
  amount?: number;
  expiresAt?: string;
  error?: string;
}

export function handleCreateVirtualAccount(
  _params: CreateVirtualAccountParams,
  _sessionId: string
): Promise<VirtualAccountResult> {
  // Account generation is not integrated. Do not create a pending order with
  // model-supplied prices for a payment flow that cannot be completed.
  return Promise.resolve({
    success: false,
    error:
      'Virtual account setup is not available in this chat yet. Please contact support for help completing your virtual-account payment.',
  });
}
