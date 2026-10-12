import { createHash, randomBytes } from 'node:crypto';
import { sanitizeCustomerLoginEmailHint } from '@baci/shared/schemas';
import { getRootDomain } from '@/env';
import { isSafeClaimSlug } from './receipt-claim-slug';

export interface ReceiptClaimMerchantUrlContext {
  slug: string | null;
  custom_domain: string | null;
}

export interface ReceiptClaimToken {
  token: string;
  tokenHash: string;
}

interface CreateReceiptClaimTokenOptions {
  bytes?: Uint8Array;
}

interface ReceiptClaimOrderItemForDeviceList {
  name: string | null;
  quantity: number | null;
}

export interface ReceiptClaimOrderForDeviceList {
  order_number: string;
  order_items?: ReceiptClaimOrderItemForDeviceList[] | null;
}

const DEFAULT_RECEIPT_CLAIM_PATH = '/receipts/claim';
const DEFAULT_DEVICE_LIST_LIMIT = 10;

function toLowercaseHex(bytes: Uint8Array) {
  return Buffer.from(bytes).toString('hex');
}

export function hashReceiptClaimToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function createReceiptClaimToken(
  options: CreateReceiptClaimTokenOptions = {}
): ReceiptClaimToken {
  const bytes = options.bytes ?? randomBytes(32);
  const token = toLowercaseHex(bytes);

  return {
    token,
    tokenHash: hashReceiptClaimToken(token),
  };
}

export function normalizeClaimEmail(email: string | null | undefined) {
  return sanitizeCustomerLoginEmailHint(email) || null;
}

export function isSafeClaimDomain(domain: string): boolean {
  // Mirrors the storefront custom-domain rules without importing the proxy
  // host module (kept dependency-free so notification senders stay inside
  // their audited import boundary): dotted hostname, no IPs, no userinfo or
  // path tricks. A trailing-dot absolute FQDN is the same host, normalized.
  // Strictly tighter than the proxy rule: every label must start and end
  // alphanumeric, stay within the 63-octet DNS label limit, and the TLD
  // must not be all-numeric, so malformed hosts fall back to the slug
  // subdomain instead of landing in a token URL.
  const host = domain
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '')
    .replace(/\.$/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
  const labels = host.split('.');
  const topLabel = labels[labels.length - 1] ?? '';
  return (
    labels.length >= 2 &&
    labels.every(
      (label) =>
        label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
    ) &&
    !/^\d+$/.test(topLabel)
  );
}

export function buildReceiptClaimUrl({
  merchant,
  token,
}: {
  merchant: ReceiptClaimMerchantUrlContext;
  token: string;
}) {
  const customDomain = merchant.custom_domain
    ?.trim()
    .toLowerCase()
    .replace(/\/+$/, '')
    .replace(/\.$/, '');
  if (customDomain && isSafeClaimDomain(customDomain)) {
    return `https://${customDomain}${DEFAULT_RECEIPT_CLAIM_PATH}/${encodeURIComponent(token)}`;
  }
  // No safe fallback exists below the slug: the subdomain carries the
  // storefront tenant, so a root-domain URL would not resolve the claim.
  // The manual sender pre-validates through the schema and fails closed
  // with re-arm instead; the import campaign surfaces this loudly rather
  // than emailing links no customer could open.
  if (typeof merchant.slug !== 'string' || !isSafeClaimSlug(merchant.slug)) {
    throw new Error('Invalid merchant slug for receipt claim URL');
  }
  const origin = `https://${merchant.slug}.${getRootDomain() || 'usebaci.com'}`;

  return `${origin}${DEFAULT_RECEIPT_CLAIM_PATH}/${encodeURIComponent(token)}`;
}

export function buildReceiptDeviceList(
  orders: ReceiptClaimOrderForDeviceList[],
  limit = DEFAULT_DEVICE_LIST_LIMIT
) {
  const devices = orders.flatMap((order) => {
    const items = order.order_items ?? [];
    if (items.length === 0) {
      return [`Receipt ${order.order_number}`];
    }

    return items.map((item) => {
      const name = item.name?.trim() || `Receipt ${order.order_number}`;
      const quantity = item.quantity ?? 1;

      return quantity > 1 ? `${quantity} x ${name}` : name;
    });
  });

  if (devices.length <= limit) {
    return devices;
  }

  return [
    ...devices.slice(0, limit),
    `and ${devices.length - limit} more receipts`,
  ];
}
