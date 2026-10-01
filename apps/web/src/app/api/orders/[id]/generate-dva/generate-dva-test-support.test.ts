import { describe, expect, it } from 'vitest';
import {
  createParams,
  createRequest,
  ORDER_ID,
} from './generate-dva-test-support';

describe('generate DVA test support', () => {
  it('builds the route request and async params for the requested order', async () => {
    const request = createRequest();

    expect(request.method).toBe('POST');
    expect(request.nextUrl.pathname).toBe(
      `/api/orders/${ORDER_ID}/generate-dva`
    );
    expect(await createParams().params).toEqual({ id: ORDER_ID });
  });
});
