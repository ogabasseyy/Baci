import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expenseReceiptStorage } from './expense-receipt';

const merchantId = '97e7a9a4-4f82-484d-a0a5-0f2ba07f4e2e';
const receiptId = '31bc282a-c36d-4bc8-815e-731ac75d1c01';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  randomUUID: vi.fn(),
  remove: vi.fn(),
  upload: vi.fn(),
}));

vi.mock('expo-crypto', () => ({
  randomUUID: () => mocks.randomUUID(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        remove: (...args: unknown[]) => mocks.remove(...args),
        upload: (...args: unknown[]) => mocks.upload(...args),
      }),
    },
  },
}));

describe('expenseReceiptStorage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    let uuidCount = 0;
    mocks.randomUUID.mockImplementation(() => {
      uuidCount += 1;
      return uuidCount === 1
        ? receiptId
        : '8a99a748-da79-4e6d-a7c6-d0a68e4e02fb';
    });
    mocks.upload.mockResolvedValue({ error: null });
    mocks.remove.mockResolvedValue({ error: null });
    mocks.fetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)),
    });
    vi.stubGlobal('fetch', mocks.fetch);
  });

  it('stores local receipt uploads under the private merchant expense prefix without upsert', async () => {
    const receipt = await expenseReceiptStorage.upload(
      merchantId,
      'file:///documents/travel-receipt.PNG'
    );

    expect(receipt).toEqual({
      storagePath: `${merchantId}/expenses/${receiptId}.png`,
    });
    expect(mocks.upload).toHaveBeenCalledWith(
      `${merchantId}/expenses/${receiptId}.png`,
      expect.any(ArrayBuffer),
      { contentType: 'image/png', upsert: false }
    );
  });

  it('uses a fresh object name for every receipt upload', async () => {
    const first = await expenseReceiptStorage.upload(
      merchantId,
      'file:///documents/first.jpg'
    );
    const second = await expenseReceiptStorage.upload(
      merchantId,
      'file:///documents/second.jpg'
    );

    expect(first.storagePath).not.toBe(second.storagePath);
    expect(second.storagePath).toBe(
      `${merchantId}/expenses/8a99a748-da79-4e6d-a7c6-d0a68e4e02fb.jpg`
    );
  });

  it.each([
    'content://media/external/images/media/123',
    'ph://asset-id',
  ])('accepts extensionless native picker URI: %s', async (uri) => {
    const receipt = await expenseReceiptStorage.upload(merchantId, uri);

    expect(receipt.storagePath).toBe(`${merchantId}/expenses/${receiptId}.jpg`);
  });

  it.each([
    ['image/png', 'png'],
    ['image/webp', 'webp'],
    ['image/heic', 'heic'],
  ])('preserves the picker MIME type for extensionless receipts: %s', async (mimeType, extension) => {
    await expenseReceiptStorage.upload(merchantId, 'content://picker/123', {
      fileName: null,
      mimeType,
    });

    expect(mocks.upload).toHaveBeenCalledWith(
      `${merchantId}/expenses/${receiptId}.${extension}`,
      expect.any(ArrayBuffer),
      { contentType: mimeType, upsert: false }
    );
  });

  it('rejects remote receipt URLs before contacting private storage', async () => {
    await expect(
      expenseReceiptStorage.upload(
        merchantId,
        'https://example.com/receipt.jpg'
      )
    ).rejects.toThrow('Receipt uploads must use a local file URI');

    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('rejects unsupported local image types', async () => {
    await expect(
      expenseReceiptStorage.upload(merchantId, 'file:///documents/receipt.gif')
    ).rejects.toThrow('Receipt image type is not supported');
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('surfaces private storage upload failures', async () => {
    mocks.upload.mockResolvedValueOnce({ error: new Error('denied') });

    await expect(
      expenseReceiptStorage.upload(merchantId, 'file:///documents/receipt.jpg')
    ).rejects.toThrow('Failed to upload expense receipt');
  });

  it('removes only an object under the exact active merchant expense prefix', async () => {
    const ownedPath = `${merchantId}/expenses/${receiptId}.jpg`;

    await expenseReceiptStorage.removeOwned(merchantId, ownedPath);

    expect(mocks.remove).toHaveBeenCalledWith([ownedPath]);
  });

  it('rejects foreign, malformed, and URL-derived deletion targets', async () => {
    const targets = [
      'other-merchant/expenses/receipt.jpg',
      `${merchantId}/expense/receipt.jpg`,
      `${merchantId}/expenses/`,
      `${merchantId}/expenses/.`,
      `${merchantId}/expenses/../${receiptId}.jpg`,
      `${merchantId}/expenses//${receiptId}.jpg`,
      `${merchantId}/expenses/nested/${receiptId}.jpg`,
      `${merchantId}/expenses/%2e%2e%2f${receiptId}.jpg`,
      `${merchantId}/expenses/..\\${receiptId}.jpg`,
      'https://example.com/public-receipt.jpg',
    ];

    for (const target of targets) {
      await expect(
        expenseReceiptStorage.removeOwned(merchantId, target)
      ).rejects.toThrow('Receipt path is not owned by the active merchant');
    }

    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
