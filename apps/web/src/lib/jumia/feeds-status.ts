import type { JumiaClient } from '@/lib/jumia/client';
import { JumiaFeedCreateResponseSchema } from '@/schemas/jumia';
import { validateRequiredString } from './feeds-validation';

export async function updateStatus(
  client: JumiaClient,
  updates: Array<{
    sellerSku: string;
    id: string;
    status: 'active' | 'inactive' | 'deleted';
    businessClients?: Array<{
      businessClientCode: string;
      status: 'active' | 'inactive' | 'deleted';
    }>;
  }>
): Promise<string> {
  if (!updates.length) {
    throw new Error('updates must be a non-empty array');
  }
  const validatedUpdates = updates.map((item) => {
    const sellerSku = validateRequiredString(
      item.sellerSku,
      'sellerSku',
      'updateStatus'
    );
    const id = validateRequiredString(item.id, 'id', 'updateStatus');
    return { ...item, sellerSku, id };
  });
  const response = await client.request(
    'POST',
    '/feeds/products/status',
    JumiaFeedCreateResponseSchema,
    { products: validatedUpdates }
  );
  return response.feedId;
}
