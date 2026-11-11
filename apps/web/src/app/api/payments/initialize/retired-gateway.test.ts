import { expect, it } from 'vitest';
import { retiredGatewayResponse } from './retired-gateway';

it('rejects CredPal without affecting supported gateways', async () => {
  const retired = retiredGatewayResponse('credpal');
  expect(retired?.status).toBe(410);
  expect(await retired?.json()).toMatchObject({ code: 'GATEWAY_RETIRED' });
  for (const gateway of ['paystack', 'korapay', 'juicyway', 'credit_direct'])
    expect(retiredGatewayResponse(gateway)).toBeNull();
});

it.each([
  'klump',
  'Klump',
  'KLUMP',
  ' KlUmP ',
])('rejects retired %s before admission', async (gateway) => {
  const retired = retiredGatewayResponse(gateway);
  expect(retired?.status).toBe(410);
  expect(await retired?.json()).toEqual({
    error: 'Klump is unavailable',
    code: 'GATEWAY_RETIRED',
  });
});
