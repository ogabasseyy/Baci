import {
  handleGetProductDetails,
  handleSearchProducts,
} from '@/ai/chat-catalog-handlers';
import {
  type GetProductDetailsParams,
  getProductDetailsSchema,
  type SearchProductsParams,
  searchProductsSchema,
  TOOL_DESCRIPTIONS,
} from '@/ai/chat-tools';

/** The catalog fallback has no checkout or order-mutation authority. */
export function createReadOnlyCatalogTools(
  _sessionId: string,
  options: {
    onToolResult?: (
      toolName: string,
      result: unknown,
      context?: { quantity?: number }
    ) => void;
  } = {}
) {
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
  };
}
