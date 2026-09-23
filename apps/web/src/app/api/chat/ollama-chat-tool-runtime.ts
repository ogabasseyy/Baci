import { ZodError } from 'zod';
import { handleCancelOrder } from '@/ai/chat-order-cancellation';
import {
  handleCheckPaymentStatus,
  handleCreateVirtualAccount,
  handleGetProductDetails,
  handleGetRecommendations,
  handleSearchProducts,
} from '@/ai/chat-tool-handlers';
import {
  CHECKOUT_TOOL_NAMES,
  cancelOrderSchema,
  checkPaymentStatusSchema,
  createVirtualAccountSchema,
  getProductDetailsSchema,
  getRecommendationsSchema,
  searchProductsSchema,
} from '@/ai/chat-tools';

const AGENTIC_CHAT_TOOL_NAME_LIST = [
  'searchProducts',
  'getProductDetails',
  'createVirtualAccount',
  'checkPaymentStatus',
  'cancelOrder',
  'getRecommendations',
] as const;

type AgenticChatToolName = (typeof AGENTIC_CHAT_TOOL_NAME_LIST)[number];

const CHECKOUT_TOOL_NAME_SET: Set<string> = new Set(CHECKOUT_TOOL_NAMES);

const AGENTIC_CHAT_TOOL_NAMES = new Set<AgenticChatToolName>(
  AGENTIC_CHAT_TOOL_NAME_LIST
);

function isAgenticChatToolName(name: string): name is AgenticChatToolName {
  return AGENTIC_CHAT_TOOL_NAMES.has(name as AgenticChatToolName);
}

function normalizeToolArguments(rawArguments: unknown): unknown {
  if (typeof rawArguments !== 'string') {
    return rawArguments ?? {};
  }

  try {
    return JSON.parse(rawArguments) as unknown;
  } catch {
    return rawArguments;
  }
}

function getToolErrorMessage(error: unknown): string {
  if (error instanceof ZodError) {
    return 'Invalid tool arguments';
  }
  return 'Tool execution failed';
}

function executeAgenticChatTool(
  name: AgenticChatToolName,
  rawArguments: unknown,
  sessionId: string
): Promise<unknown> {
  const argumentsValue = normalizeToolArguments(rawArguments);

  switch (name) {
    case 'searchProducts':
      return handleSearchProducts(searchProductsSchema.parse(argumentsValue));
    case 'getProductDetails':
      return handleGetProductDetails(
        getProductDetailsSchema.parse(argumentsValue)
      );
    case 'createVirtualAccount':
      return handleCreateVirtualAccount(
        createVirtualAccountSchema.parse(argumentsValue),
        sessionId
      );
    case 'checkPaymentStatus':
      return handleCheckPaymentStatus(
        checkPaymentStatusSchema.parse(argumentsValue),
        sessionId
      );
    case 'cancelOrder':
      return handleCancelOrder(cancelOrderSchema.parse(argumentsValue));
    case 'getRecommendations':
      return handleGetRecommendations(
        getRecommendationsSchema.parse(argumentsValue)
      );
  }
}

export async function executeAgenticChatToolForOllama(
  name: string,
  rawArguments: unknown,
  sessionId: string,
  agenticCheckoutEnabled = true
): Promise<string> {
  if (!isAgenticChatToolName(name)) {
    return JSON.stringify({ error: `Unknown tool: ${name}` });
  }

  if (agenticCheckoutEnabled === false && CHECKOUT_TOOL_NAME_SET.has(name)) {
    return JSON.stringify({ error: 'Agentic checkout disabled' });
  }

  try {
    const result = await executeAgenticChatTool(name, rawArguments, sessionId);
    return JSON.stringify(result);
  } catch (error) {
    return JSON.stringify({ error: getToolErrorMessage(error) });
  }
}
