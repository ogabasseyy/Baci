import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { createStorefrontEdgeInventory } from './create-storefront-edge-inventory';
import { createStorefrontEdgeInventoryFixture } from './storefront-edge-inventory.test-support';
import { validateStorefrontEdgeInventory } from './validate-storefront-edge-inventory';

const temporaryRoots: string[] = [];
const execFileAsync = promisify(execFile);
const toolDirectory = dirname(fileURLToPath(import.meta.url));
const tsxCliPath = createRequire(import.meta.url).resolve('tsx/cli');

async function arrangeInventory() {
  const repoRoot = await mkdtemp(join(tmpdir(), 'storefront-edge-validation-'));
  temporaryRoots.push(repoRoot);
  const originMainSha = await createStorefrontEdgeInventoryFixture(repoRoot);
  const artifact = await createStorefrontEdgeInventory({
    repoRoot,
    originMainSha,
    pilotCandidateHostnames: ['pilot.usebaci.com'],
  });
  const inputPath = join(repoRoot, 'task-1a-inventory.json');
  await writeFile(inputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  return { artifact, inputPath, originMainSha, repoRoot };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true }))
  );
});

describe('validateStorefrontEdgeInventory', () => {
  it('validates the checked-in Task 1A artifact against the live routing tree', async () => {
    // Arrange
    const repoRoot = join(toolDirectory, '../../../..');
    const inputPath = join(
      repoRoot,
      'docs/superpowers/evidence/storefront-edge/task-1a-inventory.json'
    );
    const artifact: unknown = JSON.parse(await readFile(inputPath, 'utf8'));
    if (
      artifact === null ||
      typeof artifact !== 'object' ||
      !('originMainSha' in artifact) ||
      typeof artifact.originMainSha !== 'string'
    )
      throw new Error('checked-in inventory source authority is missing');
    const sourceSha = artifact.originMainSha;
    // Act
    const result = await validateStorefrontEdgeInventory({
      repoRoot,
      inputPath,
      expectedOriginMainSha: sourceSha,
      expectedPilotCandidateHostnames: ['baci-edge-pilot.usebaci.com'],
    });

    // Assert
    expect(result).toEqual({
      inventorySha256:
        '1d1d58fa074b0e40d3439310328e1f4dd927b5594d9a63d88d85f62413999b29',
      rowCount: 558,
      storefrontEntrypointCount: 76,
    });
  });

  it('accepts an exact artifact regenerated from the checked-out tree', async () => {
    // Arrange
    const { artifact, inputPath, originMainSha, repoRoot } =
      await arrangeInventory();

    // Act
    const result = await validateStorefrontEdgeInventory({
      repoRoot,
      inputPath,
      expectedOriginMainSha: originMainSha,
      expectedPilotCandidateHostnames: ['pilot.usebaci.com'],
    });

    // Assert
    expect(result).toEqual({
      inventorySha256: artifact.inventorySha256,
      rowCount: artifact.rows.length,
      storefrontEntrypointCount: 76,
    });
  });

  it.each([
    [
      'origin authority',
      'inventory origin authority does not match origin/main',
      (value: Record<string, unknown>) => {
        value.originMainSha = 'b'.repeat(40);
      },
    ],
    [
      'hostname digest',
      'inventory artifact does not match the canonical source tree',
      (value: Record<string, unknown>) => {
        value.pilotCandidateHostnameSha256 = 'b'.repeat(64);
      },
    ],
    [
      'row order',
      'inventory artifact does not match the canonical source tree',
      (value: Record<string, unknown>) => {
        value.rows = [...(value.rows as unknown[])].reverse();
      },
    ],
    [
      'denominator policy',
      'inventory artifact does not match the canonical source tree',
      (value: Record<string, unknown>) => {
        value.eligibleDenominatorPolicy = {
          ...(value.eligibleDenominatorPolicy as Record<string, unknown>),
          methods: ['GET'],
        };
      },
    ],
    [
      'self hash',
      'inventory artifact does not match the canonical source tree',
      (value: Record<string, unknown>) => {
        value.inventorySha256 = 'b'.repeat(64);
      },
    ],
  ])('rejects a tampered %s', async (_label, message, tamper) => {
    // Arrange
    const { artifact, inputPath, originMainSha, repoRoot } =
      await arrangeInventory();
    const tampered = structuredClone(artifact) as unknown as Record<
      string,
      unknown
    >;
    tamper(tampered);
    await writeFile(inputPath, `${JSON.stringify(tampered, null, 2)}\n`);

    // Act and assert
    await expect(
      validateStorefrontEdgeInventory({
        repoRoot,
        inputPath,
        expectedOriginMainSha: originMainSha,
        expectedPilotCandidateHostnames: ['pilot.usebaci.com'],
      })
    ).rejects.toThrow(message);
  });

  it('rejects route-tree drift after the artifact was generated', async () => {
    // Arrange
    const { inputPath, originMainSha, repoRoot } = await arrangeInventory();
    const newRoute = join(
      repoRoot,
      'apps/web/src/app/(storefront)/[slug]/(content)/new/page.tsx'
    );
    await mkdir(dirname(newRoute), { recursive: true });
    await writeFile(
      newRoute,
      'export default function Page() { return null; }\n'
    );

    // Act and assert
    await expect(
      validateStorefrontEdgeInventory({
        repoRoot,
        inputPath,
        expectedOriginMainSha: originMainSha,
        expectedPilotCandidateHostnames: ['pilot.usebaci.com'],
      })
    ).rejects.toThrow('inventory regeneration failed');
  });

  it('rejects routing and proxy input drift after the artifact was generated', async () => {
    // Arrange
    const { inputPath, originMainSha, repoRoot } = await arrangeInventory();
    await writeFile(
      join(repoRoot, 'apps/web/src/proxy.ts'),
      '// changed routing authority\n'
    );

    // Act and assert
    await expect(
      validateStorefrontEdgeInventory({
        repoRoot,
        inputPath,
        expectedOriginMainSha: originMainSha,
        expectedPilotCandidateHostnames: ['pilot.usebaci.com'],
      })
    ).rejects.toThrow('inventory regeneration failed');
  });

  it('rejects a non-string pilot hostname before regeneration', async () => {
    // Arrange
    const { artifact, inputPath, originMainSha, repoRoot } =
      await arrangeInventory();
    const malformed = {
      ...artifact,
      pilotCandidateHostnames: [123],
    };
    await writeFile(inputPath, `${JSON.stringify(malformed, null, 2)}\n`);

    // Act and assert
    await expect(
      validateStorefrontEdgeInventory({
        repoRoot,
        inputPath,
        expectedOriginMainSha: originMainSha,
        expectedPilotCandidateHostnames: ['pilot.usebaci.com'],
      })
    ).rejects.toThrow('inventory input has an invalid shape');
  });

  it('rejects a self-consistent artifact outside the reviewed pilot host set', async () => {
    // Arrange
    const { inputPath, originMainSha, repoRoot } = await arrangeInventory();

    // Act and assert
    await expect(
      validateStorefrontEdgeInventory({
        repoRoot,
        inputPath,
        expectedOriginMainSha: originMainSha,
        expectedPilotCandidateHostnames: ['other.usebaci.com'],
      })
    ).rejects.toThrow(
      'inventory artifact does not match the canonical source tree'
    );
  });

  it('rejects unknown validator options', async () => {
    // Arrange
    const { inputPath, originMainSha, repoRoot } = await arrangeInventory();

    // Act and assert
    await expect(
      execFileAsync(process.execPath, [
        tsxCliPath,
        join(toolDirectory, 'validate-storefront-edge-inventory.ts'),
        '--repo-root',
        repoRoot,
        '--source-sha',
        originMainSha,
        '--input',
        inputPath,
        '--pilot-hostname',
        'pilot.usebaci.com',
        '--unexpected',
        'value',
      ])
    ).rejects.toThrow('inventory validation options are invalid');
  });
});
