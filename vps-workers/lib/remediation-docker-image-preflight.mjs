import { redactCodexError } from './remediation-codex-output.mjs';

const DEFAULT_IMAGE_CHECK_TIMEOUT_MS = 30_000;

function assertDockerImageAvailable({ dockerBin, image, runner, options }) {
  const configuredDockerBin = dockerBin || options.env?.DOCKER_BIN || 'docker';
  const timeout =
    Number.isSafeInteger(options.timeout) && options.timeout > 0
      ? options.timeout
      : DEFAULT_IMAGE_CHECK_TIMEOUT_MS;
  const result = runner(
    configuredDockerBin,
    ['image', 'inspect', '--', image],
    {
      ...options,
      timeout,
      shell: false,
    }
  );
  if (result.error) throw redactCodexError(result.error);
  if (result.status !== 0) {
    throw new Error(
      'configured BACI_CODEX_DOCKER_IMAGE is unavailable; deploy the pinned remediator image before enabling autofix'
    );
  }
}

export function assertConfiguredDockerImageAvailable({ env, runner, options }) {
  if (!env.BACI_CODEX_DOCKER_IMAGE) return;
  assertDockerImageAvailable({
    dockerBin: env.DOCKER_BIN,
    image: env.BACI_CODEX_DOCKER_IMAGE,
    options,
    runner,
  });
}
