import { z } from 'zod';
import type { MediaDeletionClient } from './delete-merchant-media';

const statesSchema = z
  .array(z.object({ path: z.string(), state: z.enum(['pending', 'deleted']) }))
  .max(100);
export async function loadMediaDeletionStates<T extends { name: string }>(
  client: Pick<MediaDeletionClient, 'rpc'>,
  merchantId: string,
  files: T[]
): Promise<Array<T & { deletionState: 'active' | 'pending' }> | null> {
  if (files.length === 0) return [];
  try {
    const result = await client.rpc('get_merchant_media_deletion_states', {
      p_merchant_id: merchantId,
      p_paths: files.map((file) => `${merchantId}/${file.name}`),
    });
    const parsed = statesSchema.safeParse(result.data);
    if (result.error || !parsed.success) return null;
    const pending = new Set(parsed.data.map((row) => row.path));
    return files.map((file) => ({
      ...file,
      deletionState: pending.has(`${merchantId}/${file.name}`)
        ? 'pending'
        : 'active',
    }));
  } catch {
    return null;
  }
}
