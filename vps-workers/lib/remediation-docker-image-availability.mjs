export function isDockerImageUnavailable(error, { args, command } = {}) {
  const executable = String(command || '')
    .split('/')
    .at(-1);
  if (executable !== 'docker' || args?.[0] !== 'run') return false;

  return /(?:unable to find image [^\r\n]+ locally|error response from daemon:\s*(?:pull access denied|manifest unknown|repository does not exist)|manifest for [^\r\n]+ not found)/i.test(
    String(error?.message || error || '')
  );
}
