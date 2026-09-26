import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  arrangeSnapshot,
  rehashSnapshot,
  snapshotGit,
  snapshotInput,
} from './storefront-edge-inventory-snapshot.test-support';
import { validateStorefrontEdgeInventory } from './validate-storefront-edge-inventory';
import { validateStorefrontEdgeInventorySnapshot } from './validate-storefront-edge-inventory-snapshot';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe('repository inventory snapshot validation', () => {
  it('survives a fresh clone after squash without certifying the lost source commit', async () => {
    const fixture = await arrangeSnapshot(roots);
    await snapshotGit(
      fixture.repoRoot,
      'checkout',
      '-b',
      'squashed',
      fixture.baseSha
    );
    await snapshotGit(fixture.repoRoot, 'merge', '--squash', 'feature');
    await snapshotGit(
      fixture.repoRoot,
      'commit',
      '--quiet',
      '-m',
      'squashed feature'
    );
    const cloneRoot = await mkdtemp(join(tmpdir(), 'snapshot-fresh-clone-'));
    roots.push(cloneRoot);
    await snapshotGit(
      fixture.repoRoot,
      'clone',
      '--no-local',
      '--single-branch',
      '--branch',
      'squashed',
      fixture.repoRoot,
      cloneRoot
    );
    await expect(
      snapshotGit(cloneRoot, 'cat-file', '-e', `${fixture.sourceSha}^{commit}`)
    ).rejects.toThrow();
    const options = {
      ...fixture,
      repoRoot: cloneRoot,
      inputPath: join(cloneRoot, 'snapshot.json'),
    };
    const currentSha = await snapshotGit(cloneRoot, 'rev-parse', 'HEAD');
    expect(currentSha).not.toBe(fixture.sourceSha);
    await expect(
      validateStorefrontEdgeInventorySnapshot(options)
    ).resolves.toEqual({
      validationKind: 'repository_snapshot',
      snapshotSha256: fixture.artifact.inventorySha256,
      validatedSourceSha: currentSha,
      rowCount: fixture.artifact.rows.length,
    });
    await expect(
      validateStorefrontEdgeInventory({
        ...options,
        expectedOriginMainSha: fixture.sourceSha,
      })
    ).rejects.toThrow('inventory regeneration failed');
  });

  it.each([
    false,
    true,
  ])('rejects changed routing bytes (committed: %s)', async (committed) => {
    const fixture = await arrangeSnapshot(roots);
    await writeFile(
      join(fixture.repoRoot, snapshotInput),
      '// changed checkout behavior\n'
    );
    if (committed) {
      await snapshotGit(fixture.repoRoot, 'add', '.');
      await snapshotGit(
        fixture.repoRoot,
        'commit',
        '--quiet',
        '-m',
        'source drift'
      );
    }
    await expect(
      validateStorefrontEdgeInventorySnapshot(fixture)
    ).rejects.toThrow(
      committed
        ? 'snapshot does not match committed source'
        : 'source tree does not match the approved commit'
    );
  });

  it('rejects an untracked route instead of accepting an incomplete path set', async () => {
    const fixture = await arrangeSnapshot(roots);
    const route = join(
      fixture.repoRoot,
      'apps/web/src/app/(storefront)/[slug]/new/page.tsx'
    );
    await mkdir(dirname(route), { recursive: true });
    await writeFile(route, 'export default function Page() { return null; }');
    await expect(
      validateStorefrontEdgeInventorySnapshot(fixture)
    ).rejects.toThrow('source tree does not match the approved commit');
  });

  it.each([
    'originMainSha',
    'inventorySha256',
  ])('rejects unbound %s metadata', async (field) => {
    const fixture = await arrangeSnapshot(roots);
    await writeFile(
      fixture.inputPath,
      JSON.stringify({
        ...fixture.artifact,
        [field]: 'a'.repeat(field === 'originMainSha' ? 40 : 64),
      })
    );
    await expect(
      validateStorefrontEdgeInventorySnapshot(fixture)
    ).rejects.toThrow('digest does not match');
  });

  it.each([
    'rows',
    'routingProxyInputSha256',
    'pilotCandidateHostnames',
    'eligibleDenominatorPolicy',
  ])('rejects rehashed %s tampering', async (field) => {
    const fixture = await arrangeSnapshot(roots);
    const artifact: Record<string, unknown> = structuredClone(fixture.artifact);
    if (field === 'rows') artifact.rows = [...fixture.artifact.rows].reverse();
    else if (field === 'pilotCandidateHostnames')
      artifact[field] = ['other.example.com'];
    else if (field === 'eligibleDenominatorPolicy')
      artifact[field] = {
        ...fixture.artifact.eligibleDenominatorPolicy,
        methods: ['DELETE'],
      };
    else artifact[field] = 'a'.repeat(64);
    await writeFile(
      fixture.inputPath,
      JSON.stringify(rehashSnapshot(artifact))
    );
    await expect(
      validateStorefrontEdgeInventorySnapshot(fixture)
    ).rejects.toThrow('snapshot does not match committed source');
  });

  it('rejects caller host or relay changes', async () => {
    const fixture = await arrangeSnapshot(roots);
    await expect(
      validateStorefrontEdgeInventorySnapshot({
        ...fixture,
        expectedPilotCandidateHostnames: ['other.example.com'],
      })
    ).rejects.toThrow('snapshot does not match');
    await expect(
      validateStorefrontEdgeInventorySnapshot({
        ...fixture,
        expectedPosthogRelayPath: '/other-relay',
      })
    ).rejects.toThrow('snapshot does not match');
  });

  it('rejects a symlink artifact', async () => {
    const fixture = await arrangeSnapshot(roots);
    const link = join(fixture.repoRoot, 'linked.json');
    await symlink(fixture.inputPath, link);
    await expect(
      validateStorefrontEdgeInventorySnapshot({ ...fixture, inputPath: link })
    ).rejects.toMatchObject({ code: 'ELOOP' });
  });
});
