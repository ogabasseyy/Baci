import {
  chmodSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { inventoryInstallationTree } from './installation-inventory';

it('detects changed bytes, permissions, extra files and symlink targets in a deterministic inventory', async () => {
  const root = mkdtempSync(join(tmpdir(), 'baci-inventory-'));
  try {
    const file = join(root, 'worker.mjs');
    writeFileSync(file, 'original', { mode: 0o644 });
    const first = await inventoryInstallationTree(root);
    expect(await inventoryInstallationTree(root)).toEqual(first);
    writeFileSync(file, 'modified');
    expect((await inventoryInstallationTree(root)).digest).not.toBe(
      first.digest
    );
    writeFileSync(file, 'original');
    chmodSync(file, 0o600);
    expect((await inventoryInstallationTree(root)).digest).not.toBe(
      first.digest
    );
    chmodSync(file, 0o644);
    expect((await inventoryInstallationTree(root)).digest).toBe(first.digest);
    writeFileSync(join(root, 'injected.mjs'), 'extra');
    expect((await inventoryInstallationTree(root)).digest).not.toBe(
      first.digest
    );
    rmSync(join(root, 'injected.mjs'));
    symlinkSync('worker.mjs', join(root, 'link'));
    const linked = await inventoryInstallationTree(root);
    rmSync(join(root, 'link'));
    symlinkSync('../outside', join(root, 'link'));
    expect((await inventoryInstallationTree(root)).digest).not.toBe(
      linked.digest
    );
    await expect(inventoryInstallationTree(join(root, 'link'))).rejects.toThrow(
      'INVALID_INSTALLATION_ROOT'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
