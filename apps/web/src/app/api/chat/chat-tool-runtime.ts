import { handleCancelOrder } from '@/ai/chat-order-cancellation';
import {
  handleAddToCart,
  handleCheckPaymentStatus,
  handleCreateVirtualAccount,
  handleGetProductDetails,
  handleGetRecommendations,
  handleSearchProducts,
} from '@/ai/chat-tool-handlers';
import {
  type AddToCartParams,
  addToCartSchema,
  type CancelOrderParams,
  type CheckPaymentStatusParams,
  type CreateVirtualAccountParams,
  cancelOrderSchema,
  checkPaymentStatusSchema,
  createVirtualAccountSchema,
  type GetProductDetailsParams,
  type GetRecommendationsParams,
  getProductDetailsSchema,
  getRecommendationsSchema,
  type SearchProductsParams,
  searchProductsSchema,
  TOOL_DESCRIPTIONS,
} from '@/ai/chat-tools';

function didAiSdkToolCreateSideEffect(
  toolName: string,
  result: string
): boolean {
  try {
    const parsed = JSON.parse(result) as unknown;
    if (typeof parsed !== 'object' || parsed === null) {
      return false;
    }

    const maybeResult = parsed as {
      accountNumber?: unknown;
      orderId?: unknown;
      success?: unknown;
      status?: unknown;
    };

    if (toolName === 'cancelOrder') {
      return (
        maybeResult.success === true &&
        maybeResult.status === 'cancelled' &&
        typeof maybeResult.orderId === 'string' &&
        maybeResult.orderId.length > 0
      );
    }

    return (
      (typeof maybeResult.orderId === 'string' &&
        maybeResult.orderId.length > 0) ||
      (maybeResult.success === true &&
        typeof maybeResult.accountNumber === 'string' &&
        maybeResult.accountNumber.length > 0)
    );
  } catch {
    return false;
  }
}

export function createAiSdkAgenticChatTools(
  sessionId: string,
  options: {
    onSideEffect?: (toolName: string) => void;
    onToolResult?: (
      toolName: string,
      result: unknown,
      context?: { quantity?: number }
    ) => void;
  } = {}
) {
  // The AI SDK executes a single step's tool calls concurrently (Promise.all).
  // A model that emits the SAME side-effecting call twice in one step (a common
  // uncertainty pattern) would otherwise run each independently — inserting a
  // duplicate chat_orders row or double-cancelling an order. Collapse concurrent
  // identical side-effecting calls onto one in-flight promise so the duplicate
  // reuses the first execution's result instead of triggering a second side
  // effect. Keyed by tool + args, so genuinely distinct calls (e.g. cancelling
  // two different orders in one turn) still each run. Map is per-request (this
  // factory is called once per chat request).
  const inFlightSideEffects = new Map<string, Promise<string>>();
  const dedupeSideEffect = (
    key: string,
    run: () => Promise<string>
  ): Promise<string> => {
    const existing = inFlightSideEffects.get(key);
    if (existing) {
      return existing;
    }
    // Clear the entry once the call SETTLES so this stays a true in-flight guard:
    // only overlapping concurrent duplicates collapse. A later sequential call
    // (e.g. a legitimate re-attempt in a subsequent tool round) — or a retry
    // after this attempt REJECTED — must run again rather than replay a stale or
    // failed result.
    const pending = run().finally(() => {
      inFlightSideEffects.delete(key);
    });
    inFlightSideEffects.set(key, pending);
    return pending;
  };

  return {
    searchProducts: {
      description: TOOL_DESCRIPTIONS.searchProducts,
      inputSchema: searchProductsSchema,
      execute: async (params: SearchProductsParams) => {
        const result = await handleSearchProducts(params);
        options.onToolResult?.('searchProducts', result);
        return JSON.stringify(result);
      },
    },
    getProductDetails: {
      description: TOOL_DESCRIPTIONS.getProductDetails,
      inputSchema: getProductDetailsSchema,
      execute: async (params: GetProductDetailsParams) => {
        const result = await handleGetProductDetails(params);
        options.onToolResult?.('getProductDetails', result);
        return JSON.stringify(result);
      },
    },
    createVirtualAccount: {
      description: TOOL_DESCRIPTIONS.createVirtualAccount,
      inputSchema: createVirtualAccountSchema,
      // Side-effecting (inserts a chat_orders row): dedupe concurrent duplicates.
      execute: (params: CreateVirtualAccountParams) =>
        dedupeSideEffect(
          `createVirtualAccount:${JSON.stringify(params)}`,
          async () => {
            const toolResult = await handleCreateVirtualAccount(
              params,
              sessionId
            );
            options.onToolResult?.('createVirtualAccount', toolResult);
            const result = JSON.stringify(toolResult);
            if (didAiSdkToolCreateSideEffect('createVirtualAccount', result)) {
              options.onSideEffect?.('createVirtualAccount');
            }
            return result;
          }
        ),
    },
    checkPaymentStatus: {
      description: TOOL_DESCRIPTIONS.checkPaymentStatus,
      inputSchema: checkPaymentStatusSchema,
      execute: async (params: CheckPaymentStatusParams) => {
        const result = await handleCheckPaymentStatus(params, sessionId);
        options.onToolResult?.('checkPaymentStatus', result);
        return JSON.stringify(result);
      },
    },
    cancelOrder: {
      description: TOOL_DESCRIPTIONS.cancelOrder,
      inputSchema: cancelOrderSchema,
      // Order cancellation must work for existing storefront orders, not only
      // orders created in this chat session. The handler verifies merchant
      // scope, order reference, customer email, and cancellable order status.
      // Side-effecting: dedupe concurrent duplicate cancels of the same order.
      execute: (params: CancelOrderParams) =>
        dedupeSideEffect(`cancelOrder:${JSON.stringify(params)}`, async () => {
          const toolResult = await handleCancelOrder(params);
          options.onToolResult?.('cancelOrder', toolResult);
          const result = JSON.stringify(toolResult);
          if (didAiSdkToolCreateSideEffect('cancelOrder', result)) {
            options.onSideEffect?.('cancelOrder');
          }
          return result;
        }),
    },
    getRecommendations: {
      description: TOOL_DESCRIPTIONS.getRecommendations,
      inputSchema: getRecommendationsSchema,
      execute: async (params: GetRecommendationsParams) => {
        const result = await handleGetRecommendations(params);
        options.onToolResult?.('getRecommendations', result);
        return JSON.stringify(result);
      },
    },
    addToCart: {
      description: TOOL_DESCRIPTIONS.addToCart,
      inputSchema: addToCartSchema,
      execute: async (params: AddToCartParams) => {
        const result = await handleAddToCart(params);
        options.onToolResult?.('addToCart', result, {
          quantity: params.quantity,
        });
        return JSON.stringify(result);
      },
    },
  };
}
