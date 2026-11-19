export function shippingCiContainerLabels(env = process.env) {
  const run = env.GITHUB_RUN_ID ?? '';
  const attempt = env.GITHUB_RUN_ATTEMPT ?? '';
  const job = env.GITHUB_JOB ?? '';
  if (
    !/^[1-9][0-9]*$/.test(run) ||
    !/^[1-9][0-9]*$/.test(attempt) ||
    !/^[a-zA-Z0-9_-]+$/.test(job)
  ) {
    return [];
  }
  return [
    `io.baci.shipping-ci.run=${run}`,
    `io.baci.shipping-ci.attempt=${attempt}`,
    `io.baci.shipping-ci.job=${job}`,
  ];
}
