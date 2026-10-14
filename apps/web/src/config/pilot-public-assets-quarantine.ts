import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';

// Runtime quarantine moves for non-lab boots with staged findings,
// split from pilot-public-assets.ts under the repo line ceiling:
// warn-and-continue alone would serve the bytes, so the offending
// entry moves beside public/ before boot continues.

export type RenameEntryFn = (source: string, target: string) => void;

// True only when the entry is genuinely gone: any other lstat failure
// (permissions, I/O) keeps the fail-closed refusal below.
export function entryGone(root: string, name: string): boolean {
  try {
    lstatSync(join(root, name));
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT';
  }
}

export function quarantinePilotEntry(
  publicDir: string,
  root: string,
  name: string,
  renameEntry: RenameEntryFn
): string {
  const vault = join(publicDir, '..', '__pilot-quarantine');
  mkdirSync(vault, { recursive: true });
  // Vault confinement: mkdir -p follows a pre-existing symlink, so a
  // vault link into public/ would report successful quarantine while
  // the entry stays statically served at the target path. The vault
  // must be a real directory whose canonical path sits outside the
  // served tree; anything else fails the quarantine (and the boot).
  const vaultStat = lstatSync(vault);
  if (!vaultStat.isDirectory() || vaultStat.isSymbolicLink()) {
    throw new Error(
      `quarantine vault "${vault}" is not a real directory — refusing to move staged content into it`
    );
  }
  const realVault = realpathSync(vault);
  const realPublic = realpathSync(publicDir);
  if (realVault === realPublic || realVault.startsWith(`${realPublic}${sep}`)) {
    throw new Error(
      `quarantine vault "${vault}" resolves inside the served public tree — refusing a quarantine that stays statically served`
    );
  }
  const target = join(vault, `${Date.now()}-${process.pid}-${name}`);
  renameEntry(join(root, name), target);
  return target;
}
