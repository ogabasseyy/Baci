export function assertFreshOwnership(run) {
  const project = 'baci-isolated-savings';
  for (const resource of ['container', 'volume', 'network']) {
    for (const filter of [
      `label=com.docker.compose.project=${project}`,
      `name=${project}`,
    ]) {
      const args = [resource, 'ls'];
      if (resource === 'container') args.push('--all');
      args.push('--filter', filter, '--quiet');
      if (run(args).trim()) {
        throw new Error(
          'Refusing preexisting isolated-savings resources; ownership review required'
        );
      }
    }
  }
}
