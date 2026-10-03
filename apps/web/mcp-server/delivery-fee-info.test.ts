import { describe, expect, it, vi } from 'vitest';
import { registerDeliveryFeeInfoTool } from './delivery-fee-info';

describe('registerDeliveryFeeInfoTool', () => {
  it('registers the public read-only tool contract and returns checkout-only guidance', async () => {
    let registeredTool: { name: string; config: Record<string, unknown>; handler: (args: { state: string; city?: string }) => Promise<unknown> } | undefined;
    const server = {
      registerTool: vi.fn((name, config, handler) => {
        registeredTool = { name, config, handler };
      }),
    };
    const sanitizeString = vi.fn((value: string, maxLength: number) => value.slice(0, maxLength).trim());

    registerDeliveryFeeInfoTool(server as never, sanitizeString);

    expect(server.registerTool).toHaveBeenCalledTimes(1);
    expect(registeredTool?.name).toBe('get_delivery_fee_info');
    expect(registeredTool?.config).toMatchObject({
      title: 'Check Delivery Fee Information',
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: {
        'openai/toolInvocation/invoking': 'Checking delivery information...',
        'openai/toolInvocation/invoked': 'Delivery information ready',
      },
    });
    const config = registeredTool?.config as { inputSchema: Record<string, unknown>; description: string };
    expect(Object.keys(config.inputSchema)).toEqual(['state', 'city']);
    expect(config.description).toContain('cannot provide a numeric quote');
    const inputSchema = config.inputSchema as {
      state: { safeParse: (value: string) => { success: boolean } };
      city: { safeParse: (value: string) => { success: boolean } };
    };
    expect(inputSchema.state.safeParse('X').success).toBe(false);
    expect(inputSchema.state.safeParse('L'.repeat(51)).success).toBe(false);
    expect(inputSchema.city.safeParse('I').success).toBe(false);
    expect(inputSchema.city.safeParse('I'.repeat(101)).success).toBe(false);

    const result = await registeredTool?.handler({ state: ' Lagos ', city: ' Ikeja ' });
    expect(sanitizeString).toHaveBeenNthCalledWith(1, ' Lagos ', 50);
    expect(sanitizeString).toHaveBeenNthCalledWith(2, ' Ikeja ', 100);
    expect(result).toEqual({
      content: [{
        type: 'text',
        text: 'Ogabassey does not publish a fixed delivery fee for Ikeja, Lagos. Enter the delivery address at checkout to confirm the fee, eligibility for any free delivery, and timing. Read the current shipping policy: https://ogabassey.com/shipping',
      }],
      structuredContent: {
        city: 'Ikeja',
        fee: null,
        policy_url: 'https://ogabassey.com/shipping',
        quote_available: false,
        state: 'Lagos',
        status: 'requires_checkout',
      },
    });
  });

  it('sanitizes state when city is omitted and keeps city null', async () => {
    let registeredHandler: ((args: { state: string; city?: string }) => Promise<unknown>) | undefined;
    const server = {
      registerTool: vi.fn((_name, _config, handler) => {
        registeredHandler = handler;
      }),
    };
    const sanitizeString = vi.fn((value: string) => value.trim());

    registerDeliveryFeeInfoTool(server as never, sanitizeString);
    const result = await registeredHandler?.({ state: ' Ogun ' }) as {
      content: Array<{ text: string }>;
      structuredContent: { city: string | null; state: string };
    };

    expect(sanitizeString).toHaveBeenCalledExactlyOnceWith(' Ogun ', 50);
    expect(result.structuredContent).toMatchObject({ city: null, state: 'Ogun' });
    expect(result.content[0]?.text).toContain('for Ogun.');
  });
});
