import { describe, expect, it, vi } from 'vitest';
import { deleteMerchantMedia } from './delete-merchant-media';

const merchant = '36690000-0000-4000-8000-000000000001';
const object = '36690000-0000-4000-8000-000000000002';
describe('shared merchant media deletion', () => {
  it('qualifies every variant before removing any bytes', async () => {
    const remove = vi.fn();
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'media_in_use' },
    });
    const failure = await deleteMerchantMedia({
      client: { rpc, storage: { from: () => ({ remove }) } },
      merchantId: merchant,
      identities: ['primary.webp', 'variant.webp'],
    });
    expect(failure?.status).toBe(409);
    expect(remove).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('claim_merchant_media_deletion_batch', {
      p_merchant_id: merchant,
      p_identities: ['primary.webp', 'variant.webp'],
    });
  });
  it('removes and completes each admitted file from one successful batch', async () => {
    const remove = vi.fn().mockResolvedValue({ error: null });
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          {
            path: `${merchant}/primary.webp`,
            object_id: object,
            state: 'pending',
          },
          {
            path: `${merchant}/variant.webp`,
            object_id: '36690000-0000-4000-8000-000000000003',
            state: 'pending',
          },
        ],
        error: null,
      })
      .mockResolvedValue({ data: true, error: null });
    await expect(
      deleteMerchantMedia({
        client: { rpc, storage: { from: () => ({ remove }) } },
        merchantId: merchant,
        identities: ['primary.webp', 'variant.webp'],
      })
    ).resolves.toBeNull();
    expect(remove).toHaveBeenCalledWith([
      `${merchant}/primary.webp`,
      `${merchant}/variant.webp`,
    ]);
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc).toHaveBeenCalledWith('complete_merchant_media_deletion', {
      p_merchant_id: merchant,
      p_path: `${merchant}/primary.webp`,
    });
    expect(rpc).toHaveBeenCalledWith('complete_merchant_media_deletion', {
      p_merchant_id: merchant,
      p_path: `${merchant}/variant.webp`,
    });
  });

  it('makes a completed retry idempotent without another Storage call', async () => {
    const remove = vi.fn();
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          path: `${merchant}/gone.webp`,
          object_id: object,
          state: 'deleted',
        },
      ],
      error: null,
    });
    expect(
      await deleteMerchantMedia({
        client: { rpc, storage: { from: () => ({ remove }) } },
        merchantId: merchant,
        identities: [object],
      })
    ).toBeNull();
    expect(remove).not.toHaveBeenCalled();
  });
  it('keeps a claim pending when completion cannot confirm removal', async () => {
    const remove = vi.fn().mockResolvedValue({ error: null });
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          {
            path: `${merchant}/file.webp`,
            object_id: object,
            state: 'pending',
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({ data: false, error: null });
    expect(
      (
        await deleteMerchantMedia({
          client: { rpc, storage: { from: () => ({ remove }) } },
          merchantId: merchant,
          identities: [object],
        })
      )?.body.code
    ).toBe('media_delete_pending');
  });
});
