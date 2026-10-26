import { beforeEach, expect, it } from 'vitest';
import {
  MERCHANT_ID,
  mocks,
  POST,
  request,
  resetPipelineMocks,
} from './route.pipeline.test-support';

beforeEach(resetPipelineMocks);

it.each([
  'purchase',
  'place_order',
])('durably records client %s without legacy paid fanout despite both grants', async (eventType) => {
  mocks.isConversionEvent.mockReturnValue(true);
  mocks.resolveContext.mockResolvedValue({
    merchantId: MERCHANT_ID,
    ok: true,
    trustLevel: 'tenant_verified_client',
    verified: true,
  });
  const response = await POST(request(MERCHANT_ID, true, eventType));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ success: true });
  expect(mocks.record).toHaveBeenCalledTimes(1);
  expect(mocks.afterCallbacks).toHaveLength(0);
  expect(mocks.createServiceClient).not.toHaveBeenCalled();
  expect(mocks.fanout).not.toHaveBeenCalled();
});
