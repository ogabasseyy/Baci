import { loadPrefundedReplay } from './replay-prefunded-loader';
import { runConfiguredReplayPass } from './replay-runtime-pass';
import { parseReplayRuntimeConfig } from './schemas/replay-runtime-config';

export async function runReplayEntrypoint(input: unknown): Promise<void> {
  try {
    if (process.env.NODE_ENV === 'production')
      throw new Error('Production replay refused');
    const configuration = parseReplayRuntimeConfig(input);
    if (configuration.paidInterestDatabase) {
      await runConfiguredReplayPass(configuration);
      return;
    }
    const prefundedReplay = configuration.prefundedReplay
      ? await loadPrefundedReplay({
          activation: configuration.prefundedReplay,
          expectedAppSystemId: configuration.appSystemId,
        })
      : undefined;
    await runConfiguredReplayPass(configuration, { prefundedReplay });
  } catch {
    throw new Error('Staging replay entrypoint refused');
  }
}
