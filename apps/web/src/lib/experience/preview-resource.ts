import type { PreviewVault } from './preview-service';
/** Every resource rechecks the fixed DB liveness projection; no cached private authority. */
export async function authorizePreviewResource(
  vault: PreviewVault,
  ticket: string,
  path: string
) {
  if (
    !/^[a-f0-9]{64}$/.test(ticket) ||
    path.includes('%') ||
    path.includes('\\')
  )
    throw Error('NOT_FOUND');
  return await vault.read(ticket, path);
}
