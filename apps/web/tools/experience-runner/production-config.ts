import { runnerProductionConfig } from '@/schemas/experience-operator-config';

/** Private operator input cannot select the listener or preflight executable. */
export function parseRunnerProductionConfig(input: unknown) {
  try {
    const config = runnerProductionConfig.parse(input);
    return {
      key: Buffer.from(config.key, 'base64url'),
      toolchainDigest: config.toolchainDigest,
      loopbackPort: config.loopbackPort,
      socketPath: '/var/lib/baci-experience-runner/run/runner.sock',
    };
  } catch {
    throw Error('INVALID_RUNNER_CONFIG');
  }
}
