import {
  createPaystackBankTransferCharge,
  isValidPaystackSubaccountCode,
} from '@/lib/agentic/paystack';
import { resolvePaystackSplitTransactionCharge } from '@/lib/payments/resolve-paystack-split-transaction-charge';
import { calculatePlatformFee as calculatePaystackFee } from '@/lib/paystack';
import { formatPhoneToE164 } from '@/lib/phone';
import { createClient as createServerSupabaseClient } from '@/lib/supabase/server';

export interface InitializePaystackBankTransferInput {
  isNigerianCustomer: boolean;
  merchantId: string;
  subaccountCode: string | null;
  reference: string;
  orderId: string;
  amount: number;
  customerEmail: string;
  customerName: string;
  customerPhone: string;
}

export type InitializePaystackBankTransferOutcome =
  | {
      ok: true;
      paymentResult: {
        authorization_url: string;
        dva: {
          bank_name: string;
          account_number: string;
          account_name: string;
          account_expires_at?: string | null;
        };
        reference: string;
        platformFee: number;
        merchantAmount: number;
      };
    }
  | {
      ok: false;
      message: string;
      code:
        | 'PAYMENT_METHOD_COUNTRY_UNSUPPORTED'
        | 'PAYSTACK_SUBACCOUNT_MISSING';
      status: 400 | 503;
    };

export async function initializePaystackBankTransfer(
  input: InitializePaystackBankTransferInput
): Promise<InitializePaystackBankTransferOutcome> {
  if (
    !input.isNigerianCustomer ||
    !formatPhoneToE164(input.customerPhone).startsWith('+234')
  ) {
    return {
      ok: false,
      message:
        'Bank transfer is only available for Nigerian checkout details. Please choose card payment or another available method.',
      code: 'PAYMENT_METHOD_COUNTRY_UNSUPPORTED',
      status: 400,
    };
  }

  if (
    !input.subaccountCode ||
    !isValidPaystackSubaccountCode(input.subaccountCode)
  ) {
    return {
      ok: false,
      message:
        'Bank transfer is not configured for this store. Please choose another payment method.',
      code: 'PAYSTACK_SUBACCOUNT_MISSING',
      status: 503,
    };
  }

  const amountInKobo = Math.round(input.amount * 100);
  const fees = calculatePaystackFee(amountInKobo);
  const { transactionChargeKobo, retainedShippingKobo } =
    await resolvePaystackSplitTransactionCharge({
      client: await createServerSupabaseClient(),
      customerEmail: input.customerEmail,
      orderId: input.orderId,
      merchantId: input.merchantId,
      amountKobo: amountInKobo,
      platformFeeKobo: fees.platformFee,
    });

  const chargeResult = await createPaystackBankTransferCharge({
    email: input.customerEmail,
    amountKobo: amountInKobo,
    reference: input.reference,
    subaccount: input.subaccountCode,
    transactionChargeKobo,
    metadata: {
      merchant_id: input.merchantId,
      order_id: input.orderId,
      customer_name: input.customerName,
      gateway: 'paystack',
      payment_type: 'bank_transfer',
      platform_fee_kobo: fees.platformFee,
      retained_shipping_kobo: retainedShippingKobo,
    },
  });

  return {
    ok: true,
    paymentResult: {
      authorization_url: '',
      dva: {
        bank_name: chargeResult.bank_name,
        account_number: chargeResult.account_number,
        account_name: chargeResult.account_name,
        ...(chargeResult.account_expires_at
          ? { account_expires_at: chargeResult.account_expires_at }
          : {}),
      },
      reference: chargeResult.reference,
      platformFee: fees.platformFee / 100,
      merchantAmount: (fees.merchantAmount - retainedShippingKobo) / 100,
    },
  };
}
