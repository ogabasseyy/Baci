import {
  buildCartSnapshot,
  buildNegotiationSingleItemInfo,
  normalizePhoneToE164,
  normalizeStoredE164Phone,
  summarizeCartForItemInfo,
} from '@baci/shared/lib';
import { isAuthSessionMissingError } from '@supabase/supabase-js';
import type { CartItem } from '@/hooks/cart';
import type { createClient } from '@/lib/supabase/client';
import { toNegotiationCartLine } from './negotiation-modal-cart';
import {
  getContactValidationError,
  normalizeOptionalEmail,
} from './negotiation-contact-validation';
import { NegotiationValidationError } from './negotiation-validation-error';

const SESSION_KEY = 'ogabassey_guest_session';

export interface NegotiationRequestInput {
  merchantId: string;
  type: 'single' | 'total';
  itemId?: string;
  productSlug?: string;
  productName: string;
  productBrand?: string;
  currentPrice: number;
  offeredPrice: number;
  evidenceUrl?: string;
  customerEmail?: string | null;
  /** Resolved by the modal before evidence upload; null is a known guest. */
  customerId?: string | null;
  customerPhone?: string | null;
  variantId?: string;
  variantName?: string;
  variantAttributes?: Record<string, string>;
  condition?: string;
  cart?: CartItem[];
}

function createGuestSessionId(): string {
  return `web-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`}`;
}

function getOrCreateSessionId(): string {
  if (typeof window === 'undefined') return `web-${Date.now()}`;

  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;

    const id = createGuestSessionId();
    window.sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return createGuestSessionId();
  }
}

export async function insertNegotiationRequest(
  supabase: ReturnType<typeof createClient>,
  request: NegotiationRequestInput
): Promise<void> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError && (!isAuthSessionMissingError(authError) || user)) {
    throw authError;
  }

  const customerId = user?.id ?? null;
  if (
    request.customerId !== undefined &&
    request.customerId !== customerId
  ) {
    throw new NegotiationValidationError(
      'Customer session changed. Please try again.'
    );
  }

  const accountEmail = normalizeOptionalEmail(user?.email);
  const accountPhone = normalizeStoredE164Phone(user?.phone);
  const validationError = getContactValidationError({
    allowMissingContact: Boolean(accountEmail || accountPhone),
    email: request.customerEmail ?? '',
    phone: request.customerPhone ?? '',
  });
  if (validationError) {
    throw new NegotiationValidationError(validationError);
  }

  const normalizedPhone =
    normalizePhoneToE164(request.customerPhone) ?? accountPhone;
  const normalizedEmail =
    normalizeOptionalEmail(request.customerEmail) ?? accountEmail;

  const cartSnapshot =
    request.type === 'total'
      ? buildCartSnapshot((request.cart ?? []).map(toNegotiationCartLine))
      : [];
  if (request.type === 'total' && cartSnapshot.length === 0) {
    throw new NegotiationValidationError(
      'Whole-cart negotiations require at least one cart item.'
    );
  }
  const totalItemInfo =
    request.type === 'total'
      ? summarizeCartForItemInfo(cartSnapshot, request.currentPrice)
      : null;

  const { error } = await supabase.from('negotiation_requests').insert({
    merchant_id: request.merchantId,
    session_id: getOrCreateSessionId(),
    customer_id: customerId,
    type: request.type,
    item_info:
      request.type === 'single'
        ? buildNegotiationSingleItemInfo(request)
        : totalItemInfo,
    cart_snapshot: cartSnapshot.length > 0 ? cartSnapshot : null,
    offered_price: request.offeredPrice,
    evidence_url: request.evidenceUrl || null,
    customer_email: normalizedEmail,
    customer_phone: normalizedPhone,
    status: 'pending',
  });

  if (error) throw error;
}
