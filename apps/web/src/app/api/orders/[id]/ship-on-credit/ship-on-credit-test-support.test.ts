import { describe, expect, it } from 'vitest';
import {
  createParams,
  createRequest,
  ORDER_ID,
} from './ship-on-credit.test-support';

describe('ship-on-credit test support', () => {
  it('builds a POST request and async route params', async () => {
    expect(createRequest({ note: 'Credit order' }).method).toBe('POST');
    expect(await createParams().params).toEqual({ id: ORDER_ID });
  });
});
