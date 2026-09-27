import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readStorefrontEdgeInventory } from './read-storefront-edge-inventory';

let root: string;
let inputPath: string;
const inventory = {
  originMainSha: 'a'.repeat(40),
  pilotCandidateHostnames: ['pilot.usebaci.com'],
  rows: [{ id: 'storefront' }],
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'inventory-reader-'));
  inputPath = join(root, 'inventory.json');
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('readStorefrontEdgeInventory', () => {
  it('reads a regular inventory file without dropping fields', async () => {
    await writeFile(inputPath, JSON.stringify(inventory));
    await expect(readStorefrontEdgeInventory(inputPath)).resolves.toEqual(
      inventory
    );
  });

  it.each([
    null,
    [],
    {},
    { ...inventory, originMainSha: 42 },
    {
      ...inventory,
      pilotCandidateHostnames: ['pilot.usebaci.com', 42],
    },
  ])('rejects an invalid inventory shape: %j', async (value) => {
    await writeFile(inputPath, JSON.stringify(value));
    await expect(readStorefrontEdgeInventory(inputPath)).rejects.toThrow(
      'inventory input has an invalid shape'
    );
  });

  it('rejects malformed JSON', async () => {
    await writeFile(inputPath, '{broken');
    await expect(readStorefrontEdgeInventory(inputPath)).rejects.toBeInstanceOf(
      SyntaxError
    );
  });

  it('rejects a directory', async () => {
    await expect(readStorefrontEdgeInventory(root)).rejects.toThrow();
  });

  it('rejects a symlink even when its target is a valid inventory', async () => {
    const target = join(root, 'target.json');
    await writeFile(target, JSON.stringify(inventory));
    await symlink(target, inputPath);
    await expect(readStorefrontEdgeInventory(inputPath)).rejects.toMatchObject({
      code: 'ELOOP',
    });
  });
});
