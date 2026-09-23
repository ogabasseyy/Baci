import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handleSearchProducts: vi.fn(),
  handleGetProductDetails: vi.fn(),
  handleCreateVirtualAccount: vi.fn(),
  handleCheckPaymentStatus: vi.fn(),
  handleCancelOrder: vi.fn(),
  handleGetRecommendations: vi.fn(),
}));

vi.mock('@/ai/chat-tool-handlers', () => mocks);
vi.mock('@/ai/chat-order-cancellation', () => ({
  handleCancelOrder: mocks.handleCancelOrder,
}));

import { executeAgenticChatToolForOllama } from '@/app/api/chat/ollama-chat-tool-runtime';

describe('ollama chat tool runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handleSearchProducts.mockResolvedValue({
      products: [{ id: 'p1', name: 'iPhone 11' }],
      total: 1,
    });
    mocks.handleCreateVirtualAccount.mockResolvedValue({
      success: true,
      accountNumber: '1234567890',
    });
    mocks.handleCancelOrder.mockResolvedValue({
      success: true,
      status: 'cancelled',
      orderId: 'order-1',
    });
  });

  it('executes Ollama tool calls with parsed JSON arguments', async () => {
    const result = await executeAgenticChatToolForOllama(
      'searchProducts',
      '{"query":"iPhone 11","maxPrice":200000}',
      'session-1'
    );

    expect(JSON.parse(result)).toEqual({
      products: [{ id: 'p1', name: 'iPhone 11' }],
      total: 1,
    });
    expect(mocks.handleSearchProducts).toHaveBeenCalledWith({
      query: 'iPhone 11',
      maxPrice: 200000,
    });
  });

  it('returns a tool error for unknown Ollama tool names', async () => {
    const result = await executeAgenticChatToolForOllama(
      'deleteProduct',
      {},
      'session-1'
    );

    expect(JSON.parse(result)).toEqual({
      error: 'Unknown tool: deleteProduct',
    });
    expect(mocks.handleSearchProducts).not.toHaveBeenCalled();
  });

  it('returns a validation error for malformed Ollama arguments', async () => {
    const result = await executeAgenticChatToolForOllama(
      'searchProducts',
      {},
      'session-1'
    );

    expect(JSON.parse(result)).toEqual({ error: 'Invalid tool arguments' });
    expect(mocks.handleSearchProducts).not.toHaveBeenCalled();
  });

  it('passes session-scoped Ollama tools to handlers that require session state', async () => {
    const args = {
      amount: 50_000,
      customerEmail: 'buyer@example.com',
      customerName: 'Buyer',
      items: [
        { productId: 'p1', name: 'iPhone 11', price: 50_000, quantity: 1 },
      ],
    };

    const result = await executeAgenticChatToolForOllama(
      'createVirtualAccount',
      JSON.stringify(args),
      'session-42'
    );

    expect(JSON.parse(result)).toEqual({
      success: true,
      accountNumber: '1234567890',
    });
    expect(mocks.handleCreateVirtualAccount).toHaveBeenCalledWith(
      args,
      'session-42'
    );
  });

  it('scopes Ollama payment status checks to the chat session', async () => {
    mocks.handleCheckPaymentStatus.mockResolvedValue({
      status: 'pending',
      orderId: 'order-1',
    });

    const result = await executeAgenticChatToolForOllama(
      'checkPaymentStatus',
      JSON.stringify({ orderId: 'order-1' }),
      'session-42'
    );

    expect(JSON.parse(result)).toEqual({
      status: 'pending',
      orderId: 'order-1',
    });
    expect(mocks.handleCheckPaymentStatus).toHaveBeenCalledWith(
      { orderId: 'order-1' },
      'session-42'
    );
  });

  it('executes Ollama order cancellation calls', async () => {
    const args = {
      orderNumber: '#00001234',
      customerEmail: 'buyer@example.com',
    };

    const result = await executeAgenticChatToolForOllama(
      'cancelOrder',
      JSON.stringify(args),
      'session-42'
    );

    expect(JSON.parse(result)).toEqual({
      success: true,
      status: 'cancelled',
      orderId: 'order-1',
    });
    expect(mocks.handleCancelOrder).toHaveBeenCalledWith(args);
  });

  it('does not execute cart mutation requests in the Ollama path', async () => {
    const result = await executeAgenticChatToolForOllama(
      'addToCart',
      JSON.stringify({ productId: 'p1' }),
      'session-42'
    );

    expect(JSON.parse(result)).toEqual({ error: 'Unknown tool: addToCart' });
  });

  it('refuses commerce tools when agentic checkout is disabled', async () => {
    const cancel = await executeAgenticChatToolForOllama(
      'cancelOrder',
      JSON.stringify({ orderId: 'order-1' }),
      'session-42',
      false
    );
    const account = await executeAgenticChatToolForOllama(
      'createVirtualAccount',
      JSON.stringify({}),
      'session-42',
      false
    );

    expect(JSON.parse(cancel)).toEqual({
      error: 'Agentic checkout disabled',
    });
    expect(JSON.parse(account)).toEqual({
      error: 'Agentic checkout disabled',
    });
    const status = await executeAgenticChatToolForOllama(
      'checkPaymentStatus',
      JSON.stringify({ customerEmail: 'a@example.com' }),
      'session-42',
      false
    );
    expect(JSON.parse(status)).toEqual({
      error: 'Agentic checkout disabled',
    });
    expect(mocks.handleCancelOrder).not.toHaveBeenCalled();
  });
});
