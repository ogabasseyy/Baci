import { fetchWithCsrf } from '@/lib/api-client';
export class MediaLibraryDeletionError extends Error {
  constructor(
    public readonly pending: boolean,
    message: string
  ) {
    super(message);
    this.name = 'MediaLibraryDeletionError';
  }
}
export async function deleteMediaFile(fileId: string): Promise<void> {
  const response = await fetchWithCsrf(
    `/api/media?id=${encodeURIComponent(fileId)}`,
    { method: 'DELETE' }
  );
  const body: unknown = await response.json().catch(() => null);
  const code =
    typeof body === 'object' && body !== null && 'code' in body
      ? body.code
      : null;
  if (
    response.ok &&
    typeof body === 'object' &&
    body !== null &&
    'success' in body &&
    body.success === true
  )
    return;
  if (code === 'media_in_use')
    throw new MediaLibraryDeletionError(
      false,
      'This file is still in use. Remove its saved references before deleting it.'
    );
  if (code === 'media_delete_pending')
    throw new MediaLibraryDeletionError(
      true,
      'Deletion is pending. Retry to finish removing this file.'
    );
  throw new MediaLibraryDeletionError(
    false,
    'Unable to delete this file. Retry later.'
  );
}
