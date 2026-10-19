import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readProtectedReplayFile } from './replay-protected-file';
import { replayPaidInterestSchemas } from './schemas/replay-paid-interest';
import { replayPrefundedSettings as schemas } from './schemas/replay-prefunded-settings';

interface Dependencies {
  read: typeof readProtectedReplayFile;
  importModule(url: string): Promise<unknown>;
  fetchImplementation: typeof fetch;
}

const bundleUrl = new URL('./prefunded-replay-bundle.mjs', import.meta.url);
const configurationPath = '/run/pvb-replay/prefunded.json';

export async function loadPrefundedReplay(
  input: {
    activation: unknown;
    expectedAppSystemId: string;
    paidInterestScope?: unknown;
  },
  dependencies: Dependencies = {
    read: readProtectedReplayFile,
    importModule: (url) => import(url),
    fetchImplementation: fetch,
  }
) {
  try {
    const activation = schemas.activation.parse(input.activation);
    if (input.expectedAppSystemId !== '7685292944002592802')
      throw new Error('Invalid app identity');
    const configurationBytes = await dependencies.read({
      path: configurationPath,
      maximumBytes: 131_072,
      allowedModes: [0o400, 0o440, 0o600],
    });
    if (
      createHash('sha256').update(configurationBytes).digest('hex') !==
      activation.configurationSha256
    )
      throw new Error('Invalid configuration digest');
    const configuration: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(configurationBytes)
    );
    if (input.paidInterestScope !== undefined) {
      const expected = replayPaidInterestSchemas.scope.parse(
        input.paidInterestScope
      );
      const { scope } =
        replayPaidInterestSchemas.factoryConfiguration.parse(configuration);
      if (
        scope.integrationId !== expected.integrationId ||
        scope.businessId !== expected.businessId ||
        scope.expectedSystemId !== expected.expectedSystemId ||
        scope.expectedSystemId !== input.expectedAppSystemId
      )
        throw new Error('Paid interest scope mismatch');
    }
    const bundle = await dependencies.read({
      path: fileURLToPath(bundleUrl),
      maximumBytes: 16 * 1024 * 1024,
      allowedModes: [0o400, 0o440, 0o600, 0o640, 0o644],
    });
    if (
      createHash('sha256').update(bundle).digest('hex') !==
      activation.bundleSha256
    )
      throw new Error('Invalid bundle digest');
    const module = schemas.module.parse(
      await dependencies.importModule(bundleUrl.href)
    );
    return schemas.runtime.parse(
      await module.createPrefundedCardReplayRuntime({
        configuration,
        expectedAppSystemId: input.expectedAppSystemId,
        fetchImplementation: dependencies.fetchImplementation,
      })
    );
  } catch {
    throw new Error('Staging prefunded replay unavailable');
  }
}
