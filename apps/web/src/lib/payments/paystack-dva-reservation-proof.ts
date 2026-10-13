import { createHmac } from 'node:crypto';

const PROOF_VERSION = 'paystack-dva-reservation:v1' as const;
const PROOF_SCOPE = 'paystack_dva_reservation' as const;

export interface PaystackDvaReservationInput {
  accountName: string;
  accountNumber: string;
  assignedAt: string;
  bankName: string;
  customerEmail: string;
  expiresAt: string;
  orderId: string;
}

export interface PaystackDvaReservationProof {
  [key: string]: string;
  account_name: string;
  account_number: string;
  assigned_at: string;
  bank_name: string;
  customer_email: string;
  expires_at: string;
  issued_at: string;
  order_id: string;
  scope: typeof PROOF_SCOPE;
  signature: string;
  version: typeof PROOF_VERSION;
}

function normalizeTimestamp(value: string, fieldName: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid Paystack DVA reservation ${fieldName}`);
  }
  return parsed.toISOString();
}

function canonicalReservationProof({
  accountName,
  accountNumber,
  assignedAt,
  bankName,
  customerEmail,
  expiresAt,
  issuedAt,
  orderId,
}: {
  accountName: string;
  accountNumber: string;
  assignedAt: string;
  bankName: string;
  customerEmail: string;
  expiresAt: string;
  issuedAt: string;
  orderId: string;
}): string {
  return [
    PROOF_VERSION,
    PROOF_SCOPE,
    orderId,
    customerEmail,
    accountNumber,
    bankName,
    accountName,
    assignedAt,
    expiresAt,
    issuedAt,
  ].join('\n');
}

function reservationProofSecret(explicitSecret?: string): string {
  const secret = explicitSecret?.trim();
  if (!secret) {
    throw new Error('Paystack DVA reservation secret is not configured');
  }
  return secret;
}

export function createPaystackDvaReservationProof(
  input: PaystackDvaReservationInput,
  options: { issuedAt?: string; secret?: string } = {}
): PaystackDvaReservationProof {
  const accountName = input.accountName.trim();
  const accountNumber = input.accountNumber.trim();
  const assignedAt = normalizeTimestamp(input.assignedAt, 'assigned_at');
  const bankName = input.bankName.trim();
  const customerEmail = input.customerEmail.trim().toLowerCase();
  const expiresAt = normalizeTimestamp(input.expiresAt, 'expires_at');
  const issuedAt = normalizeTimestamp(
    options.issuedAt ?? new Date().toISOString(),
    'issued_at'
  );
  const orderId = input.orderId.trim();

  if (
    !accountName ||
    !accountNumber ||
    !bankName ||
    !customerEmail ||
    !orderId
  ) {
    throw new Error('Invalid Paystack DVA reservation metadata');
  }

  const signature = createHmac('sha256', reservationProofSecret(options.secret))
    .update(
      canonicalReservationProof({
        accountName,
        accountNumber,
        assignedAt,
        bankName,
        customerEmail,
        expiresAt,
        issuedAt,
        orderId,
      })
    )
    .digest('hex');

  return {
    account_name: accountName,
    account_number: accountNumber,
    assigned_at: assignedAt,
    bank_name: bankName,
    customer_email: customerEmail,
    expires_at: expiresAt,
    issued_at: issuedAt,
    order_id: orderId,
    scope: PROOF_SCOPE,
    signature,
    version: PROOF_VERSION,
  };
}
