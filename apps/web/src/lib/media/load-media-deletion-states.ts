import { MEDIA_DELETION_BATCH_SIZE } from '@/config/media-deletion';
import { mediaDeletionStatesSchema } from '@/schemas/media-deletion-rpc';
import type { MediaDeletionClient } from './delete-merchant-media';

export async function loadMediaDeletionStates<T extends { name: string }>(
  client: Pick<MediaDeletionClient, 'rpc'>,
  merchantId: string,
  files: T[]
): Promise<Array<T & { deletionState: 'active' | 'pending' }> | null> {
  if (files.length === 0) return [];
  try {
    const pending = new Set<string>();
    const deleted = new Set<string>();
    for (
      let offset = 0;
      offset < files.length;
      offset += MEDIA_DELETION_BATCH_SIZE
    ) {
      const result = await client.rpc('get_merchant_media_deletion_states', {
        p_merchant_id: merchantId,
        p_paths: files
          .slice(offset, offset + MEDIA_DELETION_BATCH_SIZE)
          .map((file) => `${merchantId}/${file.name}`),
      });
      const parsed = mediaDeletionStatesSchema.safeParse(result.data);
      if (result.error || !parsed.success) return null;
      for (const row of parsed.data) {
        if (row.state === 'pending') pending.add(row.path);
        if (row.state === 'deleted') deleted.add(row.path);
      }
    }
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
