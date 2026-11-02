import { mediaDeletionStatesSchema } from '@/schemas/media-deletion-rpc';
import type { MediaDeletionClient } from './delete-merchant-media';

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
    const parsed = mediaDeletionStatesSchema.safeParse(result.data);
    if (result.error || !parsed.success) return null;
    const pending = new Set(
      parsed.data
        .filter((row) => row.state === 'pending')
        .map((row) => row.path)
    );
    const deleted = new Set(
      parsed.data
        .filter((row) => row.state === 'deleted')
        .map((row) => row.path)
    );
    return files
      .filter((file) => !deleted.has(`${merchantId}/${file.name}`))
      .map((file) => ({
        ...file,
        deletionState: pending.has(`${merchantId}/${file.name}`)
          ? 'pending'
          : 'active',
      }));
  } catch {
    return null;
  }
}
