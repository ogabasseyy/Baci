import { escapeHtmlText } from '@/lib/sanitize';
import { formatEmailMoney } from './shared';

/**
 * Focused proforma/payment-request rendering for the order email.
 * Extracted from order-confirmation.ts (300-line file limit): unpaid
 * invoice-method orders are proforma (325) quotations and unpaid Pay for
 * Me orders are payment requests — both share the transfer-instruction
 * mechanics below while keeping their own document semantics.
 */

export type ProformaDocumentKind =
  | 'confirmation'
  | 'proforma'
  | 'payment_request';

export interface ProformaVirtualAccount {
  bankName: string;
  accountNumber: string;
  accountName: string;
}

export interface ProformaEmailInput {
  documentKind?: ProformaDocumentKind;
  currency?: string;
  total: number;
  amountDue?: number;
  merchantName: string;
  merchantUrl: string;
  paymentLink?: string;
  virtualAccount?: ProformaVirtualAccount;
}

export interface ProformaContext {
  transferAmount: number;
  hasAmountDue: boolean;
  virtualAccount?: ProformaVirtualAccount;
}

/**
 * Shared derivation behind both the HTML and text bodies: the
 * outstanding balance the transfer instructions charge, whether anything
 * is due, and the NGN-compatible virtual account (if any).
 */
export function resolveProformaContext(
  input: ProformaEmailInput
): ProformaContext {
  // Transfer instructions charge the outstanding balance only: credit
  // already applied must not be charged again (P1 overpayment guard).
  const transferAmount = input.amountDue ?? input.total;
  // A zero balance (e.g. a 100% discount) has nothing to transfer: a
  // ₦0.00 instruction promising automatic confirmation is an impossible
  // next step, so zero-due quotes omit the transfer block entirely.
  const hasAmountDue = transferAmount > 0;
  // Paystack DVAs settle in NGN only: a foreign-currency quote falls back
  // to merchant-contact instructions even if a stale account object is
  // passed — never print a naira account beside a dollar amount.
  const dvaCurrencyCompatible =
    !input.currency || input.currency.trim().toUpperCase() === 'NGN';
  const virtualAccount = dvaCurrencyCompatible
    ? input.virtualAccount
    : undefined;
  return { transferAmount, hasAmountDue, virtualAccount };
}

/**
 * CTA target: the proforma/request CTA opens the order-specific tracking
 * page (status only — it cannot take payment), never the storefront
 * homepage, so customers can view the quoted invoice from the email.
 */
export function resolveOrderCtaHref(input: ProformaEmailInput): string {
  const isDocument =
    input.documentKind === 'proforma' ||
    input.documentKind === 'payment_request';
  return isDocument && input.paymentLink
    ? input.paymentLink
    : input.merchantUrl;
}

function isProformaOrRequest(input: ProformaEmailInput): boolean {
  return (
    input.documentKind === 'proforma' ||
    input.documentKind === 'payment_request'
  );
}

export function buildProformaPaymentHtml(
  input: ProformaEmailInput,
  context: ProformaContext
): string {
  if (
    !isProformaOrRequest(input) ||
    !context.virtualAccount ||
    !context.hasAmountDue
  ) {
    return '';
  }
  const account = context.virtualAccount;
  return `
          <!-- Payment Instructions -->
          <tr>
            <td style="padding: 0 40px 8px 40px;">
              <div style="background-color: #fefce8; border-radius: 8px; padding: 24px; border: 1px solid #fde68a;">
                <h3 style="margin: 0 0 12px 0; font-size: 14px; text-transform: uppercase; color: #92400e; letter-spacing: 0.5px;">💳 Complete Your Bank Transfer</h3>
                <p style="margin: 0 0 12px 0; font-size: 14px; color: #78350f; line-height: 1.6;">
                  Transfer <strong>${formatEmailMoney(context.transferAmount, input.currency)}</strong> to the dedicated account below. Your order is confirmed automatically once payment is received.
                </p>
                <table border="0" cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td style="color: #92400e; padding: 4px 0; font-size: 14px;">Bank:</td>
                    <td style="color: #1e293b; font-weight: 600; text-align: right; font-size: 14px;">${escapeHtmlText(account.bankName)}</td>
                  </tr>
                  <tr>
                    <td style="color: #92400e; padding: 4px 0; font-size: 14px;">Account Name:</td>
                    <td style="color: #1e293b; font-weight: 600; text-align: right; font-size: 14px;">${escapeHtmlText(account.accountName)}</td>
                  </tr>
                  <tr>
                    <td style="color: #92400e; padding: 4px 0; font-size: 14px;">Account Number:</td>
                    <td style="color: #1e293b; font-weight: 700; text-align: right; font-size: 16px;">${escapeHtmlText(account.accountNumber)}</td>
                  </tr>
                </table>
              </div>
            </td>
          </tr>
  `;
}

export function buildProformaIntroHtml(
  input: ProformaEmailInput,
  context: ProformaContext
): string {
  if (input.documentKind === 'payment_request') {
    if (!context.hasAmountDue) {
      return `This is a payment request for the items below. No payment is due on this request — please contact ${escapeHtmlText(input.merchantName)} if you have any questions.`;
    }
    if (context.virtualAccount) {
      return 'This is a payment request for the items below. Share the transfer details with your payer — the order will be processed once payment is received.';
    }
    return `This is a payment request for the items below. No payment account is assigned yet — please contact ${escapeHtmlText(input.merchantName)} for payment details.`;
  }
  if (context.hasAmountDue) {
    return `This proforma invoice is a quotation for the items below. Your order will be processed once payment is received — please share it with your procurement team and ${context.virtualAccount ? 'complete your bank transfer using the payment details in this email' : `contact ${escapeHtmlText(input.merchantName)} for payment details`}.`;
  }
  return `This proforma invoice is a quotation for the items below. No payment is due on this quote — please contact ${escapeHtmlText(input.merchantName)} if you have any questions.`;
}

export function buildProformaTextIntro(
  documentKind: ProformaDocumentKind | undefined,
  hasAmountDue: boolean
): string {
  if (documentKind === 'proforma') {
    return hasAmountDue
      ? 'This proforma invoice is a quotation, not a confirmed order. Your order will be processed once payment is received.'
      : 'This proforma invoice is a quotation, not a confirmed order. No payment is due on this quote.';
  }
  return hasAmountDue
    ? 'This is a payment request, not a confirmed order. Share the transfer details with your payer — the order will be processed once payment is received.'
    : 'This is a payment request, not a confirmed order. No payment is due on this request.';
}

export function buildProformaPaymentText(
  input: ProformaEmailInput,
  context: ProformaContext
): string {
  if (
    !isProformaOrRequest(input) ||
    !context.virtualAccount ||
    !context.hasAmountDue
  ) {
    return '';
  }
  const account = context.virtualAccount;
  return `
Payment Details (bank transfer):
Bank: ${account.bankName}
Account Name: ${account.accountName}
Account Number: ${account.accountNumber}`;
}

/**
 * Text next steps: the tracking link shows status only and cannot take
 * payment, so payment routes through the bank-transfer details (or the
 * merchant when no account was assigned), never through the link.
 */
export function buildProformaNextStepsText(
  input: ProformaEmailInput,
  context: ProformaContext
): string {
  const documentNoun =
    input.documentKind === 'payment_request' ? 'request' : 'quote';
  return [
    !context.hasAmountDue
      ? `No payment is due on this ${documentNoun} — please contact ` +
        `${input.merchantName} if you have any questions.`
      : context.virtualAccount
        ? input.documentKind === 'payment_request'
          ? `Share the transfer details with your payer: ${formatEmailMoney(context.transferAmount, input.currency)} to the account above — the order is confirmed automatically once payment is received.`
          : `Complete your bank transfer of ${formatEmailMoney(context.transferAmount, input.currency)} using the payment details above — your order is confirmed automatically once payment is received.`
        : `No payment account was assigned to this ${documentNoun} yet — please contact ${input.merchantName} for payment details.`,
    input.paymentLink ? `Track its status here:\n${input.paymentLink}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}
