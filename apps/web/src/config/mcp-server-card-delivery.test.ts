import { expect, it } from 'vitest';
import { z } from 'zod';
import { mcpDeliveryFeeInfoInputSchema } from '../schemas/mcp-delivery-fee-info';
import { PUBLIC_MCP_TOOLS } from './mcp-server-card-tools';

it('describes the cart tool as preparing a handoff link', () => {
  const tool = PUBLIC_MCP_TOOLS.find(
    (tool) => tool.name === 'prepare_storefront_cart_link'
  );
  expect(tool?.title).toBe('Prepare Ogabassey Cart Link');
});

it('publishes the complete live delivery input contract in the server card', () => {
  const tool = PUBLIC_MCP_TOOLS.find(
    (tool) => tool.name === 'get_delivery_fee_info'
  );
  expect(tool?.inputSchema).toEqual(
    z.toJSONSchema(mcpDeliveryFeeInfoInputSchema, { target: 'draft-7' })
  );
  expect(tool?.description).toContain('per unit');
  expect(tool?.description).toContain('checkout');
  expect(tool?.annotations).toMatchObject({
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
  });
});
