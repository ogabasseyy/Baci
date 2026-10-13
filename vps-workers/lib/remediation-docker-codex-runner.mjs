import { isDockerImageUnavailable } from './remediation-docker-image-availability.mjs';

export function createGuardedCodexRunner({
  hasRetainedWorktree,
  onUnavailableImage,
  runCodex,
}) {
  return (command, args, options) => {
    try {
      return runCodex(command, args, options);
    } catch (error) {
      if (
        !hasRetainedWorktree &&
        isDockerImageUnavailable(error, { args, command })
      ) {
        onUnavailableImage();
      }
      throw error;
    }
  };
}
