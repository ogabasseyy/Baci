import { cpSync, linkSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertPilotPublicAssets } from './pilot-public-assets';

const roots: string[] = [];
function root(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pilot-filler-hardlink-'));
  roots.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of roots.splice(0))
    rmSync(dir, { force: true, recursive: true });
});

function withFillers(dir: string): void {
  cpSync(
    join(process.cwd(), 'public/__pilot/fillers'),
    join(dir, '__pilot/fillers'),
    {
      recursive: true,
    }
  );
}

describe('hardlinked filler rejection', () => {
  it('rejects a multi-linked filler when lab is enabled', () => {
    const dir = root();
    withFillers(dir);
    // Same inode, two names: the hash still matches, but an outside
    // writer could mutate the served bytes after the boot check.
    linkSync(
      join(dir, '__pilot/fillers/grid-filler-600x400-a.png'),
      join(dir, 'outside-mirror.png')
    );
    expect(() => assertPilotPublicAssets(dir, true)).toThrow(
      /hardlinked filler/
    );
  });

  it('tolerates a multi-linked filler when lab is disabled', () => {
    // Filler policing is lab-only: non-lab refuses staged merchant
    // trees only, so an overlay nlink quirk can never take down an
    // unrelated production boot. Nothing non-lab references filler
    // bytes.
    const dir = root();
    withFillers(dir);
    linkSync(
      join(dir, '__pilot/fillers/grid-filler-600x400-a.png'),
      join(dir, 'outside-mirror.png')
    );
    expect(() => assertPilotPublicAssets(dir, false)).not.toThrow();
  });

  it('accepts single-linked fillers in both modes', () => {
    const dir = root();
    withFillers(dir);
    expect(() => assertPilotPublicAssets(dir, true)).not.toThrow();
    expect(() => assertPilotPublicAssets(dir, false)).not.toThrow();
  });
});
