import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPilotGeneration } from './generate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => join(here, 'fixtures', name);
const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

export async function setupPilot(
  source = { fixture: 'tiny-48x48.png', height: 48, width: 48 },
  slot = 'header-logo'
) {
  const base = join(
    tmpdir(),
    `pilot-sheet-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  const inputRoot = join(base, 'input');
  const outputRoot = join(base, 'output');
  const locksDir = join(base, 'locks');
  await mkdir(inputRoot, { recursive: true });
  await mkdir(locksDir, { recursive: true });
  await copyFile(fixture(source.fixture), join(inputRoot, 'tiny-a.png'));
  const bytes = await readFile(join(inputRoot, 'tiny-a.png'));
  const record = {
    assetId: 'tiny-a',
    capturedAt: '2026-10-01T20:00:00.000Z',
    contentType: 'image/png',
    height: source.height,
    merchantId: MERCHANT,
    role: 'logo',
    schemaVersion: 1,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.length,
    slot,
    sourcePath: 'tiny-a.png',
    url: `https://example.com/tiny-a.png`,
    width: source.width,
  };
  const inventoryPath = join(inputRoot, 'inventory.json');
  await writeFile(inventoryPath, JSON.stringify([record]));
  await runPilotGeneration({ inputRoot, inventoryPath, locksDir, outputRoot });
  return { base, inputRoot, inventoryPath, outputRoot };
}
