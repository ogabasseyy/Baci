/**
 * Kuda Bills Extension
 *
 * Generic bill purchase and category-based biller lookup.
 * Extends the core kuda.ts library for electricity, cable TV, and betting.
 */

import { withKudaElectricityBillItems } from '@baci/shared/lib';
import { isKudaOutcomeUnknown } from '@/lib/kuda-transport-error';
import {
  extractKudaTransactionId,
  extractKudaVoucherPin,
  normalizeKudaString,
} from '@/lib/kuda-voucher-token';
import { logger } from '@/lib/logger';
import {
  type Biller,
  buildKudaVendMessage,
  generateRequestRef,
  getBillersByType,
  KudaServiceType,
  type KudaTransactionStatusData,
  kudaRequest,
  type PurchaseResult,
  verifyBillCustomer,
} from './kuda';

// Re-export for convenience
export {
  type Biller,
  getBillersByType,
  type PurchaseResult,
  verifyBillCustomer,
};

/**
 * Maps API bill type strings to Kuda's expected category names.
 * Keys must match the billTypeEnum values in schemas/vtu.ts,
 * NOT the BillType enum values in kuda.ts (which differ for 'data').
 */
const KUDA_CATEGORY_NAMES: Record<string, string> = {
  airtime: 'Airtime',
  data: 'Internet Data',
  electricity: 'Electricity',
  cable_tv: 'CableTv',
  betting: 'Betting',
};

type BillVendOutcome = 'successful' | 'pending' | 'failed';

type BillPhoneNumberSource = 'customer_phone' | 'customer_identifier_fallback';

function isKudaBillDebugEnabled() {
  const value = process.env.KUDA_BILL_DEBUG?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

function getBillPhoneDiagnostics({
  customerIdentification,
  phoneNumber,
  suppliedCustomerPhone,
}: {
  customerIdentification: string;
  phoneNumber: string;
  suppliedCustomerPhone: string | undefined;
}): {
  hasExplicitCustomerPhone: boolean;
  phoneNumberMatchesCustomerIdentifier: boolean;
  phoneNumberSource: BillPhoneNumberSource;
} {
  const hasExplicitCustomerPhone = suppliedCustomerPhone !== undefined;

  return {
    hasExplicitCustomerPhone,
    phoneNumberMatchesCustomerIdentifier:
      phoneNumber === customerIdentification,
    phoneNumberSource: hasExplicitCustomerPhone
      ? 'customer_phone'
      : 'customer_identifier_fallback',
  };
}

function getBillVendStatusDiagnostics(
  data: KudaTransactionStatusData | undefined
) {
  return {
    billerAggregatorStatus:
      normalizeKudaString(data?.billerAggregatorStatus) ??
      normalizeKudaString(data?.BillerAggregatorStatus),
    finalStatus:
      normalizeKudaString(data?.finalStatus) ??
      normalizeKudaString(data?.FinalStatus),
    postingStatus:
      normalizeKudaString(data?.postingStatus) ??
      normalizeKudaString(data?.PostingStatus),
    transactionStatus:
      normalizeKudaString(data?.transactionStatus) ??
      normalizeKudaString(data?.TransactionStatus),
  };
}

function normalizeBillVendOutcome(
  envelopeStatus: boolean,
  data: KudaTransactionStatusData | undefined,
  pin: string | undefined
): BillVendOutcome {
  if (!envelopeStatus) return 'failed';
  if (pin) return 'successful';

  const final =
    normalizeKudaString(data?.finalStatus) ??
    normalizeKudaString(data?.FinalStatus);
  if (final) {
    const normalized = final.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (
      normalized === 'successful' ||
      normalized === 'success' ||
      normalized === 'completed' ||
      normalized === 'complete'
    ) {
      return 'successful';
    }
    if (
      normalized === 'pending' ||
      normalized === 'processing' ||
      normalized === 'inprogress'
    ) {
      return 'pending';
    }
    return 'failed';
  }

  const transactionStatus =
    normalizeKudaString(data?.transactionStatus) ??
    normalizeKudaString(data?.TransactionStatus);
  if (transactionStatus !== undefined) {
    if (transactionStatus === '3') return 'successful';
    if (transactionStatus === '1') return 'pending';
    return 'failed';
  }

  // The envelope only says Kuda accepted the API request. For bill vends,
  // absence of both a token and an inner vend status is not proof that the
  // biller completed the vend.
  return 'pending';
}

/**
 * Get billers for a bill category using our enum.
 * Convenience wrapper that maps API bill type strings to Kuda category names.
 */
export async function getBillersByCategory(
  category: string
): Promise<Biller[]> {
  const kudaName = KUDA_CATEGORY_NAMES[category];
  if (!kudaName) {
    throw new Error(`Unknown bill category: ${category}`);
  }

  const billers = await getBillersByType(kudaName);

  return category === 'electricity'
    ? withKudaElectricityBillItems(billers)
    : billers;
}

/**
 * Generic bill purchase for non-airtime/data services.
 * Works for electricity, cable TV, and betting using ADMIN_PURCHASE_BILL.
 *
 * Same Kuda service type as purchaseAirtime/purchaseData but with
 * flexible identifiers instead of hardcoded provider codes.
 * @param customerName - Customer's name for the Kuda transaction record.
 */
export async function purchaseBill(
  billItemIdentifier: string,
  customerIdentification: string,
  amount: number,
  customerName: string = 'Customer',
  requestRef?: string,
  customerPhone?: string
): Promise<PurchaseResult> {
  const reference = requestRef || generateRequestRef();
  const amountKobo = Math.round(amount * 100).toString();
  const suppliedCustomerPhone = normalizeKudaString(customerPhone);
  const phoneNumber = suppliedCustomerPhone ?? customerIdentification;
  const requestDiagnostics = {
    amount,
    amountKobo,
    billItemIdentifier,
    reference,
    serviceType: KudaServiceType.ADMIN_PURCHASE_BILL,
    ...getBillPhoneDiagnostics({
      customerIdentification,
      phoneNumber,
      suppliedCustomerPhone,
    }),
  };

  try {
    if (isKudaBillDebugEnabled()) {
      logger.info({
        message: 'Kuda bill purchase request prepared',
        ...requestDiagnostics,
      });
    }

    const response = await kudaRequest<
      KudaTransactionStatusData & { reference?: string; Reference?: string }
    >(
      KudaServiceType.ADMIN_PURCHASE_BILL,
      {
        CustomerFirstName: customerName,
        CustomerIdentifier: customerIdentification,
        // For electricity/cable_tv/betting, customerIdentification is a meter
        // number / decoder / wallet — not a phone. Use the customer's real
        // phone for SMS token delivery; only fall back to customerIdentification
        // when no phone is captured (legacy rows).
        PhoneNumber: phoneNumber,
        BillItemIdentifier: billItemIdentifier,
        Amount: amountKobo, // Naira → Kobo
        trackingReference: reference,
      },
      reference
    );

    const pin = extractKudaVoucherPin(response.data);
    const vendOutcome = normalizeBillVendOutcome(
      response.status,
      response.data,
      pin
    );
    const vendSucceeded = vendOutcome === 'successful';
    const transactionId = extractKudaTransactionId(response.data);

    if (vendOutcome !== 'successful') {
      const incompletePurchaseLog = {
        message: 'Kuda bill purchase did not complete',
        envelopeStatus: response.status,
        hasPin: Boolean(pin),
        hasTransactionId: Boolean(transactionId),
        vendOutcome,
        ...requestDiagnostics,
        ...getBillVendStatusDiagnostics(response.data),
      };
      if (vendOutcome === 'pending') {
        logger.info(incompletePurchaseLog);
      } else {
        logger.warn(incompletePurchaseLog);
      }
    }

    return {
      success: vendSucceeded,
      reference,
      transactionId,
      ...(pin && { pin }),
      message: vendSucceeded
        ? response.message
        : buildKudaVendMessage(response.message, response.data),
      status: vendOutcome,
      amount,
    };
  } catch (error) {
    return {
      success: false,
      reference,
      message: error instanceof Error ? error.message : 'Bill purchase failed',
      // Transport-unknown throws (timeout, drop, 5xx) resolve as
      // pending so BILL_TSQ reconciliation converges the row; only
      // definitive 4xx rejections fail outright (Codex R102 P1).
      status: isKudaOutcomeUnknown(error) ? 'pending' : 'failed',
      amount,
    };
  }
}
