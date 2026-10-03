import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

type SanitizeString = (value: string, maxLength: number) => string;

export function registerDeliveryFeeInfoTool(
  server: Pick<McpServer, 'registerTool'>,
  sanitizeString: SanitizeString
) {
  server.registerTool(
    'get_delivery_fee_info',
    {
      title: 'Check Delivery Fee Information',
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      description:
        'Explain how to obtain the final Ogabassey delivery fee for a Nigerian destination. The public policy does not specify fixed rates, so this tool cannot provide a numeric quote; the buyer must confirm the fee and timing at checkout.',
      inputSchema: {
        state: z.string().min(2).max(50).describe('Nigerian delivery state'),
        city: z.string().min(2).max(100).optional().describe('Delivery city'),
      },
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
      const destination = city ? `${city}, ${state}` : state;
      const policyUrl = 'https://ogabassey.com/shipping';
      return {
        content: [{
          type: 'text',
          text: `Ogabassey does not publish a fixed delivery fee for ${destination}. Enter the delivery address at checkout to confirm the fee, eligibility for any free delivery, and timing. Read the current shipping policy: ${policyUrl}`,
        }],
        structuredContent: {
          city,
          fee: null,
          policy_url: policyUrl,
          quote_available: false,
          state,
          status: 'requires_checkout',
        },
      };
    }
  );
}
