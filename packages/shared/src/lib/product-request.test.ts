import { describe, expect, it, vi } from 'vitest';
import { sendProductRequest } from './product-request';

const request = {
  query: 'iPhone 20',
  contact: 'shopper@example.com',
  merchantSlug: 'ogabassey',
  requestId: '11111111-1111-4111-8111-111111111111',
};
describe('product request intake', () => {
  it('submits validated contact and an idempotency ID through the normal RPC client', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await sendProductRequest({ rpc }, request);
    expect(rpc).toHaveBeenCalledWith('submit_storefront_product_request', {
      p_query: 'iPhone 20',
      p_contact: 'shopper@example.com',
      p_merchant_slug: 'ogabassey',
      p_request_id: request.requestId,
    });
  });
  it('rejects missing contact and punctuation-only products before a write', async () => {
    const rpc = vi.fn();
    await expect(
      sendProductRequest({ rpc }, { ...request, contact: '' })
    ).rejects.toThrow();
    await expect(
      sendProductRequest({ rpc }, { ...request, query: '!!!' })
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
  it('does not turn database failure into a success or expose raw details', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ error: { message: 'private database detail' } });
    await expect(sendProductRequest({ rpc }, request)).rejects.toThrow(
      'Couldn’t send your request. Please try again.'
    );
  });
});
