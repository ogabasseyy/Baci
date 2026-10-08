import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupLabRoots } from './lab-test-roots';

const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
describe('setupLabRoots', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds staged input/output roots with pre-staged public bytes', async () => {
    const flagBefore = process.env.BACI_IMAGE_PILOT_LAB;
    const roots = await setupLabRoots({
      accepted: [
        {
          assetId: 'logo-a',
          ladder: [96, 192, 384],
          merchantId: MERCHANT,
          role: 'logo',
          slot: 'header-logo',
          url: 'https://cdn.example.com/media/logo-a.png',
        },
      ],
    });
    // Inventory + acceptances exist and agree on the asset.
    const inventory = JSON.parse(
      await readFile(join(roots.inputRoot, 'inventory.json'), 'utf8')
    );
    expect(inventory).toHaveLength(1);
    const acceptances = JSON.parse(
      await readFile(join(roots.outputRoot, 'acceptances.json'), 'utf8')
    );
    expect(acceptances[0]?.generationId).toBe(roots.generationIds['logo-a']);
    // The pre-start staging step ran: tiers + originals are on disk.
    const staged = await readdir(
      join(roots.publicDir, '__pilot', roots.generationIds['logo-a'] as string)
    );
    expect(staged.length).toBeGreaterThan(0);
    const originals = await readdir(
      join(roots.publicDir, '__pilot', 'originals')
    );
    expect(originals).toHaveLength(1);
    expect(
      (
        await stat(
          join(roots.publicDir, '__pilot', 'originals', originals[0] as string)
        )
      ).isFile()
    ).toBe(true);
    // The lab flag is save/restored around the staging step.
    expect(process.env.BACI_IMAGE_PILOT_LAB).toBe(flagBefore);
  });

  it('creates an isolated temp root per call', async () => {
    const asset = {
      assetId: 'logo-a',
      ladder: [96, 192, 384],
      merchantId: MERCHANT,
      role: 'logo' as const,
      slot: 'header-logo',
      url: 'https://cdn.example.com/media/logo-a.png',
    };
    const first = await setupLabRoots({ accepted: [asset] });
    const second = await setupLabRoots({ accepted: [asset] });
    expect(second.inputRoot).not.toBe(first.inputRoot);
  });
});
