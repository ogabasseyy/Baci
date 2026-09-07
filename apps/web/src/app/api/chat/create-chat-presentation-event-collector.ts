import { chatToolProductSchema } from '@/schemas/chat-tool-product';
import {
  type StorefrontAgentUiEvent,
  type StorefrontAgentUiProduct,
  storefrontAgentUiContract,
} from '@/schemas/storefront-agent-ui-contract';

const MAX_SERIALIZED_TOOL_RESULT_BYTES = 256_000;

const presentationByToolName = {
  addToCart: { intent: 'add_to_cart', title: 'Ready to add' },
  getProductDetails: { intent: 'details', title: 'Product details' },
  getRecommendations: { intent: 'recommend', title: 'Recommended for you' },
  searchProducts: { intent: 'discover', title: 'Products I found' },
} as const;

type PresentationToolName = keyof typeof presentationByToolName;

function parseToolResult(result: unknown): unknown {
  if (typeof result !== 'string') return result;
  if (result.length > MAX_SERIALIZED_TOOL_RESULT_BYTES) return null;

  try {
    return JSON.parse(result) as unknown;
  } catch {
    return null;
  }
}

function getToolProducts(toolName: PresentationToolName, result: unknown) {
  const parsedResult = parseToolResult(result);

  if (toolName === 'searchProducts') {
    if (typeof parsedResult !== 'object' || parsedResult === null) return [];
    const products = (parsedResult as { products?: unknown }).products;
    return Array.isArray(products) ? products : [];
  }

  if (toolName === 'getRecommendations') {
    return Array.isArray(parsedResult) ? parsedResult : [];
  }

  return parsedResult == null ? [] : [parsedResult];
}

function normalizeNullableText(value: string | null, maxLength: number) {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeImageUrl(value: string | null): string | null {
  if (!value || value.length > 2_048) return null;

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

function createProduct(
  value: unknown,
  quantity: number | undefined
): StorefrontAgentUiProduct | null {
  const parsed = chatToolProductSchema.safeParse(value);
  if (!parsed.success) return null;

  const product = parsed.data;
  const candidate = {
    ...(product.condition !== undefined
      ? { condition: product.condition }
      : {}),
    ...(product.minimum_order_quantity !== undefined
      ? { minimumOrderQuantity: product.minimum_order_quantity }
      : {}),
    ...(product.available_conditions !== undefined
      ? { availableConditions: product.available_conditions }
      : {}),
    ...(product.has_condition_offers !== undefined
      ? { hasConditionOffers: product.has_condition_offers }
      : {}),
    ...(product.variant_model !== undefined
      ? { variantModel: product.variant_model }
      : {}),
    brand: normalizeNullableText(product.brand, 120),
    category: normalizeNullableText(product.category, 120),
    description: normalizeNullableText(product.description, 320),
    hasVariants: product.has_variants,
    id: product.id.trim().slice(0, 128),
    imageUrl: normalizeImageUrl(product.image_url),
    manageStock: product.manage_stock,
    name: product.name.trim().slice(0, 200),
    price: product.price,
    ...(quantity ? { quantity } : {}),
    slug: normalizeNullableText(product.slug, 240),
    stock: product.stock,
  };
  const event = storefrontAgentUiContract.eventSchema.safeParse({
    intent: 'discover',
    products: [candidate],
    title: 'Product',
    type: 'present_products',
  });

  return event.success ? event.data.products[0] : null;
}

function createEvent(
  toolName: PresentationToolName,
  result: unknown,
  context?: { quantity?: unknown }
): StorefrontAgentUiEvent | null {
  const requestedQuantity =
    toolName === 'addToCart' &&
    typeof context?.quantity === 'number' &&
    Number.isInteger(context.quantity) &&
    context.quantity >= 1 &&
    context.quantity <= 99
      ? context.quantity
      : undefined;
  const products = getToolProducts(toolName, result)
    .map((product) => createProduct(product, requestedQuantity))
    .filter((product): product is StorefrontAgentUiProduct => product !== null)
    .slice(0, storefrontAgentUiContract.maxProductsPerEvent);
  if (products.length === 0) return null;

  const presentation = presentationByToolName[toolName];
  const parsed = storefrontAgentUiContract.eventSchema.safeParse({
    intent: presentation.intent,
    products,
    title: presentation.title,
    type: 'present_products',
  });

  return parsed.success ? parsed.data : null;
}

/** Collects bounded, deduplicated UI events from server-owned tool results. */
export function createChatPresentationEventCollector() {
  const events: StorefrontAgentUiEvent[] = [];
  const signatures = new Set<string>();

  return {
    capture(
      toolName: string,
      result: unknown,
      context?: { quantity?: unknown }
    ): boolean {
      if (
        events.length >= storefrontAgentUiContract.maxEvents ||
        !(toolName in presentationByToolName)
      ) {
        return false;
      }

      const event = createEvent(
        toolName as PresentationToolName,
        result,
        context
      );
      if (!event) return false;

      const signature = `${event.type}:${event.intent}:${event.products
        .map((product) => `${product.id}:${product.quantity ?? ''}`)
        .join(',')}`;
      if (signatures.has(signature)) return false;

      signatures.add(signature);
      events.push(event);
      return true;
    },
    getEvents(): StorefrontAgentUiEvent[] {
      return [...events];
    },
  };
}
