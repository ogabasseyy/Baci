/**
 * Chat Tool Handlers
 *
 * Implements the actual logic for each AI tool.
 * These handlers are called when the AI invokes a tool.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { handleGetProductDetails } from '@/ai/chat-catalog-handlers';
import type { ChatProductResult } from '@/ai/chat-product-result';
import {
  type AgenticChatTenant,
  resolveAgenticChatTenant,
} from '@/lib/agentic/agentic-chat-tenant';
import { createAgenticScopedSupabaseClient } from '@/lib/agentic/scoped-supabase';
import type {
  AddToCartParams,
  CheckPaymentStatusParams,
  CreateVirtualAccountParams,
} from './chat-tools';

export {
  handleGetProductDetails,
  handleGetRecommendations,
  handleSearchProducts,
} from './chat-catalog-handlers';

type ChatToolSupabaseClient = Pick<SupabaseClient, 'from' | 'rpc'>;

interface ChatCheckoutTenantClient {
  tenant: AgenticChatTenant;
  supabase: ChatToolSupabaseClient;
}

async function createCheckoutToolTenantClient(
  sessionId: string
): Promise<ChatCheckoutTenantClient | null> {
  const tenant = await resolveAgenticChatTenant();
  if (!tenant?.agenticCheckoutEnabled) return null;

  return {
    tenant,
    supabase: createScopedClient(tenant, sessionId),
  };
}

function createScopedClient(
  tenant: AgenticChatTenant,
  sessionId?: string
): ChatToolSupabaseClient {
  return createAgenticScopedSupabaseClient({
    merchantId: tenant.merchantId,
    merchantSlug: tenant.merchantSlug,
    sessionId,
  });
}

// ============================================
// CREATE VIRTUAL ACCOUNT
// ============================================

interface VirtualAccountResult {
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
      'Bank transfer payment is temporarily unavailable. Please use card payment at checkout or contact support.',
  });
}

// ============================================
// CHECK PAYMENT STATUS
// ============================================

interface PaymentStatusResult {
  status: 'pending' | 'paid' | 'expired' | 'not_found';
  orderId?: string;
  paidAt?: string;
  amount?: number;
  accountNumber?: string;
  bankName?: string;
}

function getMetadataString(
  metadata: Record<string, unknown> | null,
  key: 'account_number' | 'bank_name'
): string | null {
  const value = metadata?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function handleCheckPaymentStatus(
  params: CheckPaymentStatusParams,
  sessionId: string
): Promise<PaymentStatusResult> {
  const scoped = await createCheckoutToolTenantClient(sessionId);
  if (!scoped) return { status: 'not_found' };

  const { supabase } = scoped;
  const merchantId = scoped.tenant.merchantId;

  try {
    let order: {
      id: string;
      status: string;
      paid_at: string | null;
      created_at: string;
      subtotal: number;
      virtual_account_number: string | null;
      virtual_account_bank: string | null;
      metadata: Record<string, unknown> | null;
    } | null = null;

    // Try to find order by orderId first, then by email
    if (params.orderId) {
      const { data } = await supabase
        .from('chat_orders')
        .select(
          'id, status, paid_at, created_at, subtotal, virtual_account_number, virtual_account_bank, metadata'
        )
        .eq('id', params.orderId)
        .eq('merchant_id', merchantId)
        .eq('session_id', sessionId)
        .maybeSingle();

      if (data) {
        order = data;
      }
    }

    // If no orderId or not found, try by email (most recent)
    if (!order && params.customerEmail) {
      const { data } = await supabase
        .from('chat_orders')
        .select(
          'id, status, paid_at, created_at, subtotal, virtual_account_number, virtual_account_bank, metadata'
        )
        .eq('customer_email', params.customerEmail)
        .eq('merchant_id', merchantId)
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data) {
        order = data;
      }
    }

    if (!order) {
      return { status: 'not_found' };
    }

    const accountNumber =
      order.virtual_account_number ||
      getMetadataString(order.metadata, 'account_number');
    const bankName =
      order.virtual_account_bank ||
      getMetadataString(order.metadata, 'bank_name');

    if (order.status === 'paid') {
      return {
        status: 'paid',
        orderId: order.id,
        paidAt: order.paid_at || undefined,
        amount: order.subtotal,
      };
    }

    // Check if expired (30 min from creation)
    const createdAt = new Date(order.created_at);
    const expiresAt = new Date(createdAt.getTime() + 30 * 60 * 1000);

    if (new Date() > expiresAt) {
      return { status: 'expired', orderId: order.id };
    }

    return {
      status: 'pending',
      orderId: order.id,
      amount: order.subtotal,
      accountNumber: accountNumber || undefined,
      bankName: bankName || undefined,
    };
  } catch (err) {
    console.error('[Chat Tools] Payment status error:', err);
    return { status: 'not_found' };
  }
}

// ============================================
// ADD TO CART (Returns product for frontend)
// ============================================

export function handleAddToCart(
  params: AddToCartParams
): Promise<ChatProductResult | null> {
  // Just return the product details - actual cart management happens on frontend
  return handleGetProductDetails({ productId: params.productId });
}
