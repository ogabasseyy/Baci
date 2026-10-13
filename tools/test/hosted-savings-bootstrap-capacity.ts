import { statfs } from 'node:fs/promises';

export async function assertHostedSavingsCapacity(
  repositoryRoot: string,
  inspect = statfs
) {
  const storage = await inspect(repositoryRoot);
  const available = storage.bavail * storage.bsize;
  const minimum = 20 * 1024 ** 3;
  if (!Number.isSafeInteger(available) || available < minimum)
    throw new Error(
      'Local replay requires at least 20 GiB free; no resources started'
    );
  return available;
}
