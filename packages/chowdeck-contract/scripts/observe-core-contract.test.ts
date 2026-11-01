import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runHiddenInputSession,
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

describe('hidden TTY input lifecycle', () => {
  it.each(['success', 'error'] as const)(
    'restores echo and zeros owned buffers on %s',
    async (mode) => {
      const echoStates: boolean[] = [];
      const apiKey = Buffer.from('secret-api-key');
      const merchantReference = Buffer.from('merchant-ref');

      const operation = runHiddenInputSession({
        driver: {
          setEcho: async (enabled: boolean) => {
            echoStates.push(enabled);
          },
          readSecrets: async () => ({ apiKey, merchantReference }),
          installSignalHandler: () => () => undefined,
        },
        action: async () => {
          if (mode !== 'success') throw new Error('unsafe bait secret-api-key');
          return 'ok';
        },
      });

      if (mode === 'success') await expect(operation).resolves.toBe('ok');
      else await expect(operation).rejects.toThrow('Observation failed');
      expect(echoStates).toEqual([false, true]);
      expect(apiKey.every((byte) => byte === 0)).toBe(true);
      expect(merchantReference.every((byte) => byte === 0)).toBe(true);
    }
  );

  it('cancels pending input promptly and never starts the action after a signal', async () => {
    const echoStates: boolean[] = [];
    const apiKey = Buffer.from('secret-api-key');
    const merchantReference = Buffer.from('merchant-ref');
    let signalHandler: (() => void) | undefined;
    let resolveInput:
      | ((value: { apiKey: Buffer; merchantReference: Buffer }) => void)
      | undefined;
    let actionCalls = 0;

    const operation = runHiddenInputSession({
      driver: {
        setEcho: async (enabled: boolean) => echoStates.push(enabled),
        readSecrets: async () =>
          new Promise((resolve) => {
            resolveInput = resolve;
          }),
        installSignalHandler: (handler: () => void) => {
          signalHandler = handler;
          return () => undefined;
        },
      },
      action: async () => {
        actionCalls += 1;
        return 'unsafe';
      },
    });
    await Promise.resolve();

    signalHandler?.();
    await expect(operation).rejects.toThrow('Observation failed');
    expect(actionCalls).toBe(0);
    expect(echoStates).toEqual([false, true]);

    resolveInput?.({ apiKey, merchantReference });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(apiKey.every((byte) => byte === 0)).toBe(true);
    expect(merchantReference.every((byte) => byte === 0)).toBe(true);
  });

  it('cancels a pending action promptly and supplies its abort signal', async () => {
    const echoStates: boolean[] = [];
    const apiKey = Buffer.from('secret-api-key');
    const merchantReference = Buffer.from('merchant-ref');
    let signalHandler: (() => void) | undefined;
    let actionSignal: AbortSignal | undefined;
    let actionStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      actionStarted = resolve;
    });

    const operation = runHiddenInputSession({
      driver: {
        setEcho: async (enabled: boolean) => echoStates.push(enabled),
        readSecrets: async () => ({ apiKey, merchantReference }),
        installSignalHandler: (handler: () => void) => {
          signalHandler = handler;
          return () => undefined;
        },
      },
      action: async (_secrets, signal) => {
        actionSignal = signal;
        actionStarted?.();
        return new Promise<string>(() => undefined);
      },
    });
    await started;

    signalHandler?.();
    await expect(operation).rejects.toThrow('Observation failed');
    expect(actionSignal?.aborted).toBe(true);
    expect(echoStates).toEqual([false, true]);
    expect(apiKey.every((byte) => byte === 0)).toBe(true);
    expect(merchantReference.every((byte) => byte === 0)).toBe(true);
  });

  it('attempts buffer clearing and echo restoration when signal disposal throws', async () => {
    const echoStates: boolean[] = [];
    const apiKey = Buffer.from('secret-api-key');
    const merchantReference = Buffer.from('merchant-ref');

    const operation = runHiddenInputSession({
      driver: {
        setEcho: async (enabled: boolean) => echoStates.push(enabled),
        readSecrets: async () => ({ apiKey, merchantReference }),
        installSignalHandler: () => () => {
          throw new Error('unsafe disposer detail');
        },
      },
      action: async () => 'ok',
    });

    await expect(operation).rejects.toThrow('Observation failed');
    expect(echoStates).toEqual([false, true]);
    expect(apiKey.every((byte) => byte === 0)).toBe(true);
    expect(merchantReference.every((byte) => byte === 0)).toBe(true);
  });

  it('sanitizes echo restoration failure after clearing owned buffers', async () => {
    const apiKey = Buffer.from('secret-api-key');
    const merchantReference = Buffer.from('merchant-ref');

    const operation = runHiddenInputSession({
      driver: {
        setEcho: async (enabled: boolean) => {
          if (enabled) throw new Error('unsafe restore detail secret-api-key');
        },
        readSecrets: async () => ({ apiKey, merchantReference }),
        installSignalHandler: () => () => undefined,
      },
      action: async () => 'ok',
    });

    await expect(operation).rejects.toThrow(/^Observation failed$/);
    expect(apiKey.every((byte) => byte === 0)).toBe(true);
    expect(merchantReference.every((byte) => byte === 0)).toBe(true);
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
