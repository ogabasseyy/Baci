import crypto from 'node:crypto';
import { parseSantaAction } from '@baci/shared/lib';
import { getCachedSantaProductList } from '@/ai/santa-data';
import type { AgenticChatTenant } from '@/lib/agentic/agentic-chat-tenant';
import { createAgenticScopedSupabaseClient } from '@/lib/agentic/scoped-supabase';

const MAX_CLIENT_IP_LENGTH = 64;
const MAX_PRODUCT_NAME_LENGTH = 200;
const MAX_RESPONSE_LENGTH = 1000;
const MAX_USER_MESSAGE_LENGTH = 500;

type SantaInteractionType = 'chat' | 'wish_granted' | 'wish_denied';

function createSantaSessionId(clientIp: string): string {
  return crypto
    .createHash('sha256')
    .update(`santa:${clientIp}`)
    .digest('hex')
    .slice(0, 32);
}

function getRequestedPrice(message: string | undefined): number | null {
  const match = message?.match(/(\d[\d,]*)\s*(million|k|naira|₦)?/i);
  if (!match) return null;

  let amount = Number(match[1].replace(/,/g, ''));
  if (match[2]?.toLowerCase() === 'million') amount *= 1_000_000;
  if (match[2]?.toLowerCase() === 'k') amount *= 1_000;
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function getInteractionType(response: string): {
  approvedPrice: number | null;
  productName: string | null;
  type: SantaInteractionType;
} {
  const action = parseSantaAction(response);
  if (action) {
    return {
      approvedPrice: action.price,
      productName: action.productName.slice(0, MAX_PRODUCT_NAME_LENGTH),
      type: 'wish_granted',
    };
  }

  const denied =
    /budget.*below/i.test(response) ||
    /can(?:not|'t).*approve/i.test(response) ||
    /cannot.*grant/i.test(response) ||
    /workshop has costs/i.test(response) ||
    /save up/i.test(response) ||
    /payment plan/i.test(response);

  return {
    approvedPrice: null,
    productName: null,
    type: denied ? 'wish_denied' : 'chat',
  };
}

/**
 * Records a bounded campaign event using a short-lived signed RLS client.
 * The migration binds merchant and session claims and only permits event types
 * produced here, so request headers cannot select a tenant or forge analytics.
 */
export async function logSantaInteraction({
  clientIp,
  response,
  tenant,
  userMessage,
}: {
  clientIp: string;
  response: string;
  tenant: AgenticChatTenant;
  userMessage: string | undefined;
}): Promise<void> {
  const interaction = getInteractionType(response);
  const requestedPrice = getRequestedPrice(userMessage);
  // Discounts are measured against the catalog price, never the customer's
  // stated budget: an over-budget full-price grant is a 0% discount, not a
  // windfall. Unknown catalog prices record no discount rather than a
  // budget-derived fiction.
  const catalogPrice = interaction.productName
    ? (
        await getCachedSantaProductList(
          tenant.merchantId,
          tenant.priceNegotiationEnabled
        )
      ).find((product) => product.name === interaction.productName)?.price
    : undefined;
  const discountPercentage =
    interaction.approvedPrice !== null &&
    catalogPrice !== undefined &&
    catalogPrice > 0
      ? Math.max(
          ((catalogPrice - interaction.approvedPrice) / catalogPrice) * 100,
          0
        )
      : null;
  const sessionId = createSantaSessionId(clientIp);
  const supabase = createAgenticScopedSupabaseClient({
    merchantId: tenant.merchantId,
    merchantSlug: tenant.merchantSlug,
    sessionId,
  });

  const { error } = await supabase.from('santa_interactions').insert({
    approved_price: interaction.approvedPrice,
    client_ip: clientIp.slice(0, MAX_CLIENT_IP_LENGTH),
    discount_percentage: discountPercentage,
    interaction_type: interaction.type,
    merchant_id: tenant.merchantId,
    product_name: interaction.productName,
    requested_price: requestedPrice,
    santa_response: response.slice(0, MAX_RESPONSE_LENGTH),
    session_id: sessionId,
    user_message: userMessage?.slice(0, MAX_USER_MESSAGE_LENGTH) ?? null,
  });

  if (error) {
    throw new Error('Santa interaction could not be recorded');
  }
}
