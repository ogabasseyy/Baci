import type { SupabaseClient } from '@supabase/supabase-js';
import type { calculateCheckoutSession } from '@/lib/agentic/checkout';
import type {
  AgenticCheckoutBuyer,
  StoredDvaAccount,
} from '@/lib/agentic/checkout-completion-response';
import type { AgenticMetadata } from '@/lib/agentic/checkout-storage';

type CheckoutCalculation = Awaited<ReturnType<typeof calculateCheckoutSession>>;

export interface FinalizeAgenticCheckoutInput {
  agentId?: string | null;
  buyer: AgenticCheckoutBuyer;
  dvaAccount: StoredDvaAccount;
  expectedSessionUpdatedAt?: string;
  finalizationClaimOverride?: string;
  idempotencyKey: string;
  merchantId: string;
  metadata: AgenticMetadata;
  orderSession: {
    currency: string;
    merchant_id: string;
    session_id: string;
    shipping_address?: unknown;
  };
  orderSessionCalc: CheckoutCalculation;
  /**
   * Preparing principal of the bound shared-cart checkout session,
   * resolved by the caller from the server-side session record. The
   * binding RPC requires it whenever the session carries a binding;
   * unresolved bindings fail closed at submit.
   */
  sharedCartPrincipalId?: string | null;
  requestId: string;
  route: string;
  sessionId: string;
  supabase: SupabaseClient;
}
