import { expect, it } from 'vitest';
import { retiredGatewayResponse } from './retired-gateway';

it('rejects CredPal without affecting supported gateways', async () => {
  const retired = retiredGatewayResponse('credpal');
  expect(retired?.status).toBe(410);
  expect(await retired?.json()).toMatchObject({ code: 'GATEWAY_RETIRED' });
  for (const gateway of [
    'paystack',
    'korapay',
    'juicyway',
    'credit_direct',
    'klump',
  ])
    expect(retiredGatewayResponse(gateway)).toBeNull();
});
