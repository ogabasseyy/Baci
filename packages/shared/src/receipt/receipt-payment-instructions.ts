import { getBankNameFromCode } from './bank-codes';
import { escapeHtml } from './escape-html';
import type { ReceiptMerchant, ReceiptOptions, ReceiptOrder } from './types';

export interface ReceiptPaymentInstructionParams {
  order: ReceiptOrder;
  merchant: ReceiptMerchant;
  options: ReceiptOptions;
  brandPrimary: string;
  brandAccent: string;
  contactEmail: string | null;
  contactPhone: string | null;
  isPaid: boolean;
}

function sanitizePaymentLink(rawLink: string): string | null {
  const trimmed = rawLink.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

export function renderBankDetailsHtml({
  order,
  merchant,
  options,
  brandPrimary,
  brandAccent,
  contactEmail,
  contactPhone,
  isPaid,
}: ReceiptPaymentInstructionParams): string {
  if (isPaid) {
    return '';
  }
  // Nothing remains due (fully discounted or fully credited): transfer
  // instructions would describe an impossible payment, even when a stale
  // virtual account is still attached to the order.
  if (order.balance <= 0) {
    return '';
  }

  const parts: string[] = [];

  if (order.virtual_account) {
    const va = order.virtual_account;
    parts.push(`
        <div class="bank-card">
          <div class="bank-label" style="display:flex;align-items:center;gap:6px;">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${brandPrimary};flex-shrink:0;"></span>
            Automatic Confirmation
          </div>
          <div class="bank-hint">Transfer here for instant order confirmation</div>
          <div class="bank-row"><span class="bank-key">Bank</span><span class="bank-val">${escapeHtml(va.bank_name)}</span></div>
          <div class="bank-row"><span class="bank-key">Account Name</span><span class="bank-val">${escapeHtml(va.account_name)}</span></div>
          <div class="bank-row"><span class="bank-key">Account Number</span><span class="bank-val bank-acct">${escapeHtml(va.account_number)}</span></div>
        </div>`);
  }

  if (merchant.bank_account_number) {
    const merchantBankCard = renderMerchantBankCard({
      merchant,
      brandAccent,
      brandPrimary,
      contactEmail,
      contactPhone,
    });
    if (merchantBankCard) {
      parts.push(merchantBankCard);
    }
  }

  const paymentLink = options.paymentLink
    ? sanitizePaymentLink(options.paymentLink)
    : null;
  if (paymentLink) {
    parts.push(`
        <div class="bank-card">
          <div class="bank-label">Pay Online</div>
          <div style="text-align:center;padding:8px 0;">
            <a href="${escapeHtml(paymentLink)}" style="display:inline-block;padding:8px 20px;background:${brandPrimary};color:#fff;border-radius:6px;text-decoration:none;font-weight:700;font-size:12px;">Pay Now</a>
          </div>
          <div style="font-size:9px;color:#9ca3af;text-align:center;margin-top:6px;word-break:break-all;">${escapeHtml(paymentLink)}</div>
        </div>`);
  }

  if (parts.length === 0) {
    return '';
  }

  return `
        <div class="section-block">
          <div class="section-label">Payment Instructions</div>
          <div class="bank-grid">${parts.join('')}</div>
        </div>`;
}

function renderMerchantBankCard({
  merchant,
  brandAccent,
  brandPrimary,
  contactEmail,
  contactPhone,
}: Pick<
  ReceiptPaymentInstructionParams,
  'merchant' | 'brandAccent' | 'brandPrimary' | 'contactEmail' | 'contactPhone'
>): string {
  const rawBankName = merchant.bank_name?.trim();
  const hasValidBankName =
    rawBankName &&
    rawBankName.toLowerCase() !== 'unknown' &&
    rawBankName.toLowerCase() !== 'unknown bank' &&
    rawBankName.toLowerCase() !== 'n/a';
  const resolvedBankName = hasValidBankName
    ? rawBankName
    : getBankNameFromCode(merchant.bank_code) || '';
  if (!resolvedBankName) {
    return '';
  }

  const contactRow = renderManualConfirmationContactRow({
    brandPrimary,
    contactEmail,
    contactPhone,
  });

  return `
          <div class="bank-card">
            <div class="bank-label" style="display:flex;align-items:center;gap:6px;">
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${brandAccent};flex-shrink:0;"></span>
              Manual Confirmation
            </div>
            <div class="bank-hint">Transfer here &amp; notify merchant to confirm</div>
            <div class="bank-row"><span class="bank-key">Bank</span><span class="bank-val">${escapeHtml(resolvedBankName)}</span></div>
            <div class="bank-row"><span class="bank-key">Account Name</span><span class="bank-val">${escapeHtml(merchant.bank_account_name || merchant.business_name || '')}</span></div>
            <div class="bank-row"><span class="bank-key">Account Number</span><span class="bank-val bank-acct">${escapeHtml(merchant.bank_account_number || '')}</span></div>
            ${contactRow}
          </div>`;
}

function renderManualConfirmationContactRow({
  brandPrimary,
  contactEmail,
  contactPhone,
}: Pick<
  ReceiptPaymentInstructionParams,
  'brandPrimary' | 'contactEmail' | 'contactPhone'
>): string {
  const phoneIcon = contactPhone
    ? `<a href="tel:${escapeHtml(contactPhone)}" style="display:inline-flex;align-items:center;gap:4px;color:${brandPrimary};text-decoration:none;font-size:10px;font-weight:600;">&#9742; ${escapeHtml(contactPhone)}</a>`
    : '';
  const emailIcon = contactEmail
    ? `<a href="mailto:${escapeHtml(contactEmail)}" style="display:inline-flex;align-items:center;gap:4px;color:${brandPrimary};text-decoration:none;font-size:10px;font-weight:600;">&#9993; ${escapeHtml(contactEmail)}</a>`
    : '';

  if (!phoneIcon && !emailIcon) {
    return '';
  }

  return `<div class="bank-contact">${phoneIcon}${phoneIcon && emailIcon ? '<span style="color:#d1d5db;margin:0 6px;">|</span>' : ''}${emailIcon}</div>`;
}
