export function builderCiContainerLabels(env = process.env) {
  const run = env.GITHUB_RUN_ID ?? '';
  const attempt = env.GITHUB_RUN_ATTEMPT ?? '';
  const job = env.GITHUB_JOB ?? '';
  const scope =
    env.BACI_FIXTURE_SCOPE ?? (job === 'quality-test-web' ? '' : 'single');
  if (
    !/^[1-9][0-9]*$/.test(run) ||
    !/^[1-9][0-9]*$/.test(attempt) ||
    !/^[a-zA-Z0-9_-]+$/.test(job) ||
    !/^[a-zA-Z0-9_-]+$/.test(scope)
  )
    return [];
  return [
    `io.baci.builder-ci.run=${run}`,
    `io.baci.builder-ci.attempt=${attempt}`,
    `io.baci.builder-ci.job=${job}`,
    `io.baci.builder-ci.scope=${scope}`,
  ];
}

export function builderCiDockerArgs(env = process.env) {
  if (env.GITHUB_ACTIONS !== 'true') return [];
  const labels = builderCiContainerLabels(env);
  if (labels.length !== 4)
    throw new Error('Missing builder fixture CI identity');
  return labels.flatMap((label) => ['--label', label]);
}
