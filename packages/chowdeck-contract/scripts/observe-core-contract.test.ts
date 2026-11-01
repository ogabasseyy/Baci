import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runObserveCoreCli,
  validateCoreObservationManifest,
} from './observe-core-contract.mjs';

const DIGEST = `sha256:${'c'.repeat(64)}`;

function blockedManifest() {
  return {
    version: 1,
    baseUrl: 'https://api.chowdeck.com/merchant',
    publicContractDigest: DIGEST,
    readiness: 'blocked_contract_evidence',
    blockerCode: 'provider_response_schema_unproven',
    limits: {
      maxRequests: 20,
      requestTimeoutMs: 10_000,
      totalTimeoutMs: 60_000,
      responseBytes: 1_048_576,
      totalBytes: 5_242_880,
      maxDepth: 32,
      maxNodes: 20_000,
    },
    transport: {
      method: 'GET',
      redirect: 'error',
      acceptEncoding: 'identity',
    },
    operations: [
      {
        id: 'account_profile',
        pathTemplate: '/',
        evidence: 'documented',
        enabled: false,
        blockerCode: 'provider_response_schema_unproven',
      },
      {
        id: 'category_list',
        pathTemplate: '/{merchantReference}/menucategory',
        evidence: 'documented',
        enabled: false,
        blockerCode: 'pagination_semantics_unproven',
      },
      {
        id: 'menu_list',
        pathTemplate: '/{merchantReference}/menu',
        evidence: 'documented',
        enabled: false,
        blockerCode: 'pagination_semantics_unproven',
      },
      {
        id: 'menu_item',
        pathTemplate: '/{merchantReference}/menu/{menuReference}',
        evidence: 'documented',
        enabled: false,
        blockerCode: 'provider_response_schema_unproven',
      },
    ],
  };
}

async function pathIsMissing(path: string): Promise<boolean> {
  try {
    await stat(path);
    return false;
  } catch {
    return true;
  }
}

describe('core observation manifest', () => {
  it('accepts only the fixed GET-only host, paths, and safety ceilings', () => {
    expect(validateCoreObservationManifest(blockedManifest())).toEqual(blockedManifest());
  });

  it.each([
    ['private host', { baseUrl: 'http://localhost:3000/merchant' }],
    ['redirects', { transport: { method: 'GET', redirect: 'follow', acceptEncoding: 'identity' } }],
    ['mutation', { transport: { method: 'POST', redirect: 'error', acceptEncoding: 'identity' } }],
    ['compression', { transport: { method: 'GET', redirect: 'error', acceptEncoding: 'gzip' } }],
    ['request count', { limits: { ...blockedManifest().limits, maxRequests: 21 } }],
  ])('rejects unsafe %s policy', (_name, replacement) => {
    expect(() => validateCoreObservationManifest({ ...blockedManifest(), ...replacement })).toThrow(
      'Invalid observation manifest'
    );
  });

  it('rejects unknown operations, enabled operations, and duplicate operation ids', () => {
    const manifest = blockedManifest();

    expect(() =>
      validateCoreObservationManifest({
        ...manifest,
        operations: [{ ...manifest.operations[0], pathTemplate: '/orders' }],
      })
    ).toThrow('Invalid observation manifest');
    expect(() =>
      validateCoreObservationManifest({
        ...manifest,
        operations: [{ ...manifest.operations[0], enabled: true }],
      })
    ).toThrow('Invalid observation manifest');
    expect(() =>
      validateCoreObservationManifest({
        ...manifest,
        operations: [manifest.operations[0], manifest.operations[0]],
      })
    ).toThrow('Invalid observation manifest');
  });
});

describe('observe core CLI checkpoint', () => {
  it('fails before credential prompts, requests, and output while contract evidence is blocked', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chowdeck-observe-'));
    const manifestPath = join(directory, 'manifest.json');
    const outputPath = join(directory, 'observation.json');
    const writes: string[] = [];
    let ttyCalls = 0;
    let fetchCalls = 0;

    const result = await runObserveCoreCli({
      argv: ['--manifest', manifestPath, '--out', outputPath],
      readManifest: async () => JSON.stringify(blockedManifest()),
      openTty: async () => {
        ttyCalls += 1;
        throw new Error('must not open');
      },
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response();
      },
      writeOutput: async (path: string) => {
        writes.push(path);
      },
    });

    expect(result).toEqual({ code: 'BLOCKED_CONTRACT_EVIDENCE' });
    expect(ttyCalls).toBe(0);
    expect(fetchCalls).toBe(0);
    expect(writes).toEqual([]);
    expect(await pathIsMissing(outputPath)).toBe(true);
  });

  it('fails closed with no output for malformed, partial, or oversized manifest input', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chowdeck-observe-'));
    const outputPath = join(directory, 'observation.json');
    const inputs = ['{', JSON.stringify({ version: 1 }), 'x'.repeat(1_048_577), JSON.stringify(blockedManifest()).replace('\"version\":1', '\"version\":1,\"version\":1')];

    for (const input of inputs) {
      await expect(
        runObserveCoreCli({
          argv: ['--manifest', join(directory, 'manifest.json'), '--out', outputPath],
          readManifest: async () => input,
          openTty: async () => {
            throw new Error('must not open');
          },
          fetchImpl: async () => new Response(),
          writeOutput: async () => undefined,
        })
      ).rejects.toThrow('Observation failed');
      expect(await pathIsMissing(outputPath)).toBe(true);
    }
  });
});
