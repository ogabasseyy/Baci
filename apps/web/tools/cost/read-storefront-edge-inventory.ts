import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';

type InventoryReadCandidate = Readonly<{
  originMainSha: string;
  pilotCandidateHostnames: readonly string[];
}> &
  Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isInventoryReadCandidate(
  value: unknown
): value is InventoryReadCandidate {
  if (!isRecord(value)) return false;
  const candidate = value;
  return (
    typeof candidate.originMainSha === 'string' &&
    Array.isArray(candidate.pilotCandidateHostnames) &&
    candidate.pilotCandidateHostnames.every(
      (hostname: unknown) => typeof hostname === 'string'
    )
  );
}

export async function readStorefrontEdgeInventory(
  path: string
): Promise<InventoryReadCandidate> {
  const handle = await open(
    resolve(path),
    constants.O_RDONLY | constants.O_NOFOLLOW
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile())
      throw new Error('inventory input must be a regular file');
    const value: unknown = JSON.parse(await handle.readFile('utf8'));
    if (!isInventoryReadCandidate(value))
      throw new Error('inventory input has an invalid shape');
    return value;
  } finally {
    await handle.close();
  }
}
