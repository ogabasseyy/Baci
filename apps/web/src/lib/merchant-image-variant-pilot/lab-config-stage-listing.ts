import 'server-only';
import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { sep } from 'node:path';

// Fail-closed directory listing for the stage guard, split out of
// lab-config-stage-guard.ts under the repo line ceiling: a
// searchable-but-unreadable directory (mode 0111) still serves known
// pathnames, so a listing failure must abort verification — extras
// would go undiscovered. Only a MISSING directory is skippable, and
// only when nothing is expected under it: expected files in a
// missing dir refuse right here instead of relying on downstream
// byte verification.
export async function listStagedDir(
  dir: string,
  label: string,
  expected: ReadonlySet<string>
): Promise<Dirent[] | null> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      throw new Error(
        `merchant image pilot: cannot list staged directory under ${label} (${error instanceof Error ? error.message : String(error)})`
      );
    }
    for (const file of expected) {
      if (file === dir || file.startsWith(`${dir}${sep}`)) {
        throw new Error(
          `merchant image pilot: staged directory under ${label} is missing with bound files — re-stage to reconcile`
        );
      }
    }
    return null;
  }
}
