/**
 * Chat Tool Handlers
 *
 * Implements the actual logic for each AI tool.
 * These handlers are called when the AI invokes a tool.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createAgenticScopedSupabaseClient } from '@/lib/agentic/scoped-supabase';
import type {
  CheckPaymentStatusParams,
  CreateVirtualAccountParams,
} from './chat-tools';

// Ogabassey merchant ID (hardcoded for now, can be made dynamic)
const OGABASSEY_MERCHANT_ID = '3bc72679-c0f7-4db4-9054-6a4a4a95a498';
const OGABASSEY_MERCHANT_SLUG = 'ogabassey';

type ChatToolSupabaseClient = Pick<SupabaseClient, 'from' | 'rpc'>;

function createChatToolSupabaseClient(
  sessionId?: string
): ChatToolSupabaseClient {
  return createAgenticScopedSupabaseClient({
    merchantId: OGABASSEY_MERCHANT_ID,
    merchantSlug: OGABASSEY_MERCHANT_SLUG,
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

export async function handleCreateVirtualAccount(
  params: CreateVirtualAccountParams,
  sessionId: string
): Promise<VirtualAccountResult> {
  const supabase = createChatToolSupabaseClient(sessionId);

  try {
    // 1. Create the chat order first
    const subtotal = params.items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    const { data: order, error: orderError } = await supabase
      .from('chat_orders')
      .insert({
        merchant_id: OGABASSEY_MERCHANT_ID,
        session_id: sessionId,
        customer_email: params.customerEmail,
        customer_name: params.customerName,
        customer_phone: params.customerPhone || null,
        items: params.items,
        subtotal: subtotal,
        status: 'pending_payment',
      })
      .select('id')
      .single();

    if (orderError || !order) {
      console.error('[Chat Tools] Order creation error:', orderError);
      return { success: false, error: 'Failed to create order' };
    }

    // Virtual account generation via Kuda API is not yet integrated.
    // Block this flow to prevent customers from sending money to fake accounts.
    // TODO: Replace with an actual Kuda virtual-account API call when ready.
    console.warn(
      '[Chat Tools] Virtual account creation blocked — Kuda API not integrated. Order:',
      order.id
    );
    return {
      success: false,
      orderId: order.id,
      error:
        'Bank transfer payment is temporarily unavailable. Please use card payment at checkout or contact support.',
    };
  } catch (err) {
    console.error('[Chat Tools] Virtual account error:', err);
    return { success: false, error: 'Failed to generate payment account' };
  }
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
  const supabase = createChatToolSupabaseClient(sessionId);

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
        .eq('merchant_id', OGABASSEY_MERCHANT_ID)
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
        .eq('merchant_id', OGABASSEY_MERCHANT_ID)
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

export { handleAddToCart } from '@/ai/chat-catalog-cart';
export { handleGetProductDetails } from '@/ai/chat-catalog-details';
export { handleSearchProducts } from '@/ai/chat-catalog-handlers';
export { handleGetRecommendations } from '@/ai/chat-catalog-recommendations';
