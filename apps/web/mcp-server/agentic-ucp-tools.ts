import { z } from 'zod';
import type { McpServer } from "@modelcontextprotocol/server";
import type { AgenticCheckoutClientConfig } from './agentic-checkout-client';
import {
  cancelUcpCart,
  cancelUcpCartInputSchema,
  convertUcpCartToCheckout,
  convertUcpCartToCheckoutInputSchema,
  createUcpCart,
  createUcpCartInputSchema,
  getUcpCart,
  getUcpCartInputSchema,
  lookupUcpCatalogItems,
  lookupUcpCatalogItemsInputSchema,
  searchUcpCatalog,
  searchUcpCatalogInputSchema,
  updateUcpCart,
  updateUcpCartInputSchema,
} from './agentic-ucp-client';
import type { AgenticUcpRequestResult } from './agentic-ucp-request';

type UcpResult = Extract<AgenticUcpRequestResult, { ok: true }>;

export function registerAgenticUcpTools(
  server: McpServer,
  config: AgenticCheckoutClientConfig
) {

  server.registerTool(
    'search_ucp_catalog',
    {
      title: 'Search UCP Catalog',
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
      description:
        'Search Ogabassey products through the signed UCP catalog search route.',
      inputSchema: z.object(searchUcpCatalogInputSchema),
      _meta: {
        'openai/toolInvocation/invoking': 'Searching UCP catalog...',
        'openai/toolInvocation/invoked': 'UCP catalog search complete',
      },
    },
    async (args) =>
      buildUcpToolResponse({
        action: 'search the UCP catalog',
        responseKey: 'catalog',
        result: await searchUcpCatalog(args, config),
        successText: () => 'UCP catalog search completed.',
      })
  );

  server.registerTool(
    'lookup_ucp_catalog_items',
    {
      title: 'Lookup UCP Catalog Items',
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
      description:
        'Fetch exact Ogabassey product IDs through the signed UCP catalog lookup route.',
      inputSchema: z.object(lookupUcpCatalogItemsInputSchema),
      _meta: {
        'openai/toolInvocation/invoking': 'Looking up UCP catalog items...',
        'openai/toolInvocation/invoked': 'UCP catalog items loaded',
      },
    },
    async (args) =>
      buildUcpToolResponse({
        action: 'lookup UCP catalog items',
        responseKey: 'catalog',
        result: await lookupUcpCatalogItems(args, config),
        successText: () => 'UCP catalog item lookup completed.',
      })
  );

  server.registerTool(
    'create_ucp_cart',
    {
      title: 'Create UCP Cart',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
        idempotentHint: false,
      },
      description:
        'Create a persistent signed UCP cart session for selected products and quantities.',
      inputSchema: z.object(createUcpCartInputSchema),
      _meta: {
        'openai/toolInvocation/invoking': 'Creating UCP cart...',
        'openai/toolInvocation/invoked': 'UCP cart created',
      },
    },
    async (args) =>
      buildUcpToolResponse({
        action: 'create a UCP cart',
        responseKey: 'cart',
        result: await createUcpCart(args, config),
        successText: cartSuccessText('Created UCP cart'),
      })
  );

  server.registerTool(
    'get_ucp_cart',
    {
      title: 'Get UCP Cart',
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
        idempotentHint: true,
      },
      description: 'Read a signed UCP cart session state.',
      inputSchema: z.object(getUcpCartInputSchema),
      _meta: {
        'openai/toolInvocation/invoking': 'Reading UCP cart...',
        'openai/toolInvocation/invoked': 'UCP cart loaded',
      },
    },
    async (args) =>
      buildUcpToolResponse({
        action: 'read the UCP cart',
        responseKey: 'cart',
        result: await getUcpCart(args, config),
        successText: cartSuccessText('Loaded UCP cart'),
      })
  );

  server.registerTool(
    'update_ucp_cart',
    {
      title: 'Update UCP Cart',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
        idempotentHint: false,
      },
      description:
        'Replace UCP cart line items, buyer details, currency, or fulfillment context.',
      inputSchema: z.object(updateUcpCartInputSchema),
      _meta: {
        'openai/toolInvocation/invoking': 'Updating UCP cart...',
        'openai/toolInvocation/invoked': 'UCP cart updated',
      },
    },
    async (args) =>
      buildUcpToolResponse({
        action: 'update the UCP cart',
        responseKey: 'cart',
        result: await updateUcpCart(args, config),
        successText: cartSuccessText('Updated UCP cart'),
      })
  );

  server.registerTool(
    'convert_ucp_cart_to_checkout',
    {
      title: 'Convert UCP Cart To Checkout',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
        idempotentHint: false,
      },
      description:
        'Create or reuse a Baci checkout session from a persistent UCP cart.',
      inputSchema: z.object(convertUcpCartToCheckoutInputSchema),
      _meta: {
        'openai/toolInvocation/invoking': 'Converting UCP cart...',
        'openai/toolInvocation/invoked': 'UCP cart converted',
      },
    },
    async (args) =>
      buildUcpToolResponse({
        action: 'convert the UCP cart to checkout',
        responseKey: 'checkout_session',
        result: await convertUcpCartToCheckout(args, config),
        successText: checkoutSuccessText,
      })
  );

  server.registerTool(
    'cancel_ucp_cart',
    {
      title: 'Cancel UCP Cart',
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
        idempotentHint: true,
      },
      description: 'Cancel an active signed UCP cart session.',
      inputSchema: z.object(cancelUcpCartInputSchema),
      _meta: {
        'openai/toolInvocation/invoking': 'Canceling UCP cart...',
        'openai/toolInvocation/invoked': 'UCP cart canceled',
      },
    },
    async (args) =>
      buildUcpToolResponse({
        action: 'cancel the UCP cart',
        responseKey: 'cart',
        result: await cancelUcpCart(args, config),
        successText: cartSuccessText('Canceled UCP cart'),
      })
  );
}

function buildUcpToolResponse({
  action,
  responseKey,
  result,
  successText,
}: {
  action: string;
  responseKey: string;
  result: AgenticUcpRequestResult;
  successText: (result: UcpResult) => string;
}) {
  if (result.ok === false) {
    return {
      content: [
        { type: 'text' as const, text: `Unable to ${action}: ${result.error}` },
      ],
      structuredContent: {
        details: result.details ?? null,
        endpoint: result.endpoint ?? null,
        error: result.error,
        idempotency_key: result.idempotencyKey ?? null,
        request_id: result.requestId ?? null,
        status: 'error',
        status_code: result.status,
      },
    };
  }

  return {
    content: [{ type: 'text' as const, text: successText(result) }],
    structuredContent: {
      [responseKey]: result.response,
      endpoint: result.endpoint,
      idempotency_key: result.idempotencyKey ?? null,
      request_id: result.requestId,
      status: 'success',
    },
  };
}

function cartSuccessText(prefix: string) {
  return (result: UcpResult) => {
    const cartId = getResponseField(result.response, 'id') ?? 'cart';
    const status = getResponseField(result.response, 'status') ?? 'unknown';
    return `${prefix} ${cartId}. Status: ${status}.`;
  };
}

function checkoutSuccessText(result: UcpResult) {
  const sessionId = getResponseField(result.response, 'id') ?? 'checkout';
  const status = getResponseField(result.response, 'status') ?? 'created';
  return `Converted UCP cart to checkout session ${sessionId}. Status: ${status}.`;
}

function getResponseField(response: unknown, field: string) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    return undefined;
  }
  const value = (response as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : undefined;
}
