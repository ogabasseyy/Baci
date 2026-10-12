import { createHash } from 'node:crypto';
import { readProtectedReplayFile } from './replay-protected-file';
import { replayAccrualObserverSchemas as schemas } from './schemas/replay-accrual-observer';
import { replayPrefundedSettings } from './schemas/replay-prefunded-settings';

export async function readAccrualObserverConfiguration(
  input: {
    observer: unknown;
    activation: unknown;
    expectedAppSystemId: string;
  },
  read = readProtectedReplayFile
) {
  try {
    const observer = schemas.observer.parse(input.observer);
    const activation = replayPrefundedSettings.activation.parse(
      input.activation
    );
    const bytes = await read({
      path: '/run/pvb-replay/prefunded.json',
      maximumBytes: 131072,
      allowedModes: [0o400, 0o440, 0o600],
    });
    if (
      createHash('sha256').update(bytes).digest('hex') !==
      activation.configurationSha256
    )
      throw new Error('Configuration digest refused');
    const configuration = schemas.factoryConfiguration.parse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    );
    const { scope, evidence } = configuration;
    if (
      scope.expectedSystemId !== input.expectedAppSystemId ||
      scope.expectedSystemId !== evidence.systemIdentifier ||
      scope.integrationId !== evidence.integrationId ||
      scope.integrationId !== observer.database.integrationId ||
      scope.businessId !== observer.database.businessId
    )
      throw new Error('Observer scope refused');
    return {
      observer,
      signingSecret: evidence.webhookSecret,
      scope: {
        integrationId: scope.integrationId,
        businessId: scope.businessId,
        expectedSystemId: scope.expectedSystemId,
      },
    };
  } catch {
    throw new Error('Staging accrual observer configuration unavailable');
  }
}
