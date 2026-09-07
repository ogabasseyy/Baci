'use server';

import { startRepairPickupPayment } from '@/lib/repairs/start-repair-pickup-payment';
import type { RepairBookingInput } from '@/lib/validations/repair';

// Public-by-design storefront action. The core validates the form, merchant
// binding, live GIGL quote, and signed Paystack amount before creating payment.
export async function startCustomerRepairPickupPayment(
  data: RepairBookingInput,
  expectedPickupFee: number,
  merchantId: string,
  merchantIdentifier: string,
  resumeToken?: string | null
) {
  return await startRepairPickupPayment({
    data,
    expectedPickupFee,
    merchantId,
    merchantIdentifier,
    resumeToken,
  });
}
