import { mcpToolOutputSchemas } from '../src/schemas/mcp-tool-output';
import type { DeliveryInput, DeliveryQuoteResult } from './delivery-gigl-quotes';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { mcpDeliveryFeeInfoInputSchema } from '../src/schemas/mcp-delivery-fee-info';

type SanitizeString = (value: string, maxLength: number) => string;

export function registerDeliveryFeeInfoTool(
  server: Pick<McpServer, 'registerTool'>,
  sanitizeString: SanitizeString,
  loadQuotes?: (input: DeliveryInput) => Promise<DeliveryQuoteResult>
) {
  server.registerTool(
    'get_delivery_fee_info',
    {
      outputSchema: mcpToolOutputSchemas.get_delivery_fee_info,
      title: 'Check Delivery Fee Information',
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      description:
        'Get live GIG Logistics delivery estimates for selected Ogabassey catalog products and quantities to a Nigerian city/state. Ask for products, quantity, city and any missing packed weight of one unit of each product before quoting. Weight is per unit and is multiplied by quantity; if given a combined package weight, ask for the per-unit packed weight. Never invent rates or weights. Returns door or station-pickup estimates with expiry; final address, eligibility and price must be confirmed at checkout. This tool does not modify a cart, place an order, book shipping or take payment.',
      inputSchema: mcpDeliveryFeeInfoInputSchema.shape,
      _meta: {
        'openai/toolInvocation/invoking': 'Checking delivery information...',
        'openai/toolInvocation/invoked': 'Delivery information ready',
      },
    },
    async (args) => {
      const state = sanitizeString(args.state, 50);
      const city = args.city ? sanitizeString(args.city, 100) : null;
      if (state.length < 2 || (args.city !== undefined && (!city || city.length < 2))) {
        return {
          content: [{
            type: 'text',
            text: 'Please provide a valid Nigerian state and, if supplied, a valid city name.',
          }],
          isError: true,
        };
      }
      const policyUrl = 'https://ogabassey.com/shipping';
      let result: DeliveryQuoteResult;
      if (!args.items?.length) {
        result = { status: 'needs_items', message: 'Which Ogabassey products and quantities should I quote? Delivery depends on the shipment. Confirm the final fee and timing at checkout.', quotes: [] };
      } else if (!city) {
        result = { status: 'needs_city', message: 'Please provide the delivery city for a GIG quote.', quotes: [] };
      } else {
        try {
          result = loadQuotes ? await loadQuotes({ ...args, state, city }) : { status: 'unavailable', message: 'Live GIG quotes are unavailable. Confirm delivery at checkout.', quotes: [] };
        } catch {
          result = { status: 'unavailable', message: 'Live GIG quotes are unavailable. Confirm delivery at checkout.', quotes: [] };
        }
      }
      const structuredContent = {
        ...result,
        city, state, policy_url: policyUrl,
        fee: result.status === 'quoted' && args.delivery_preference && result.quotes.length ? Math.min(...result.quotes.map((quote) => quote.fee)) : null,
        quote_available: result.status === 'quoted' && result.quotes.length > 0,
      };
      const parsed = mcpToolOutputSchemas.get_delivery_fee_info.safeParse(structuredContent);
      if (!parsed.success) {
        return { content: [{ type: 'text' as const, text: 'Live GIG quotes are unavailable. Confirm delivery at checkout.' }], isError: true };
      }
      const lines = result.quotes.map((quote) => `GIG Logistics ${quote.service}: NGN ${quote.fee} (${quote.delivery_type}); expires ${quote.expires_at}${quote.station_name ? `; pickup at ${quote.station_name}, ${quote.station_address ?? 'address unconfirmed'}` : ''}.`);
      return {
        content: [{ type: 'text' as const, text: [result.message, ...lines, `Shipping policy: ${policyUrl}`].join('\n') }],
        structuredContent: parsed.data,
      };
    }
  );
}
