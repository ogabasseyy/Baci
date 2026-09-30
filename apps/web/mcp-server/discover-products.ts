import type { SupabaseClient } from '@supabase/supabase-js';
import { mcpDiscoveryIntentSchema, type McpDiscoveryIntent } from '../src/schemas/mcp-discovery-intent';
import { discoverStructuredProducts } from './discover-structured-products';

type DiscoveryArgs = {
  intent?: McpDiscoveryIntent;
  brand?: string;
  category?: string;
  condition?: string;
  limit?: number;
  max_price?: number;
  min_price?: number;
  query?: string;
  sort?: 'price_asc' | 'price_desc' | 'newest' | 'relevance';
};

type DiscoveryInput = {
  args: DiscoveryArgs;
  merchantId: string;
  sanitizeString: (input: string, maxLength?: number) => string;
  semanticSearch?: (query: string, offset: number) => Promise<string[]>;
  supabase: SupabaseClient;
};

function safeQuery(args: DiscoveryArgs, sanitizeString: DiscoveryInput['sanitizeString']): string | undefined {
  const query = args.query ? sanitizeString(args.query, 100).trim() : '';
  return query || undefined;
}

export async function discoverMcpProducts({
  args,
  merchantId,
  sanitizeString,
  semanticSearch,
  supabase,
}: DiscoveryInput) {
  const query = safeQuery(args, sanitizeString);
  if (args.intent === undefined) {
    return {
      selectedProducts: [],
      sanitizedQuery: query,
      priceScanComplete: true,
      invalidIntentMessage: 'Search intent is required. Specify the product type, brand or model, and any product specifications to search.',
    };
  }

  const parsed = mcpDiscoveryIntentSchema.safeParse(args.intent);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) =>
      issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message).join('; ');
    return {
      selectedProducts: [],
      sanitizedQuery: query,
      priceScanComplete: true,
      invalidIntentMessage: `Invalid search intent: ${details || 'intent rejected by schema'}`,
    };
  }

  return discoverStructuredProducts({
    intent: parsed.data,
    args,
    merchantId,
    supabase,
    semanticSearch,
    query,
  });
}
