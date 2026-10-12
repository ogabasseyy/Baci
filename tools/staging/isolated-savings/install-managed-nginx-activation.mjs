import { prepareManagedNginxActivation } from './managed-nginx-activation.mjs';

export async function runManagedNginxActivation(
  { binding, input, config },
  actions,
  { persistent = false } = {}
) {
  let backup;
  let activated = false;
  let candidate;
  let failure;
  try {
    candidate = prepareManagedNginxActivation(
      binding,
      input,
      input.now,
      config
    );
    await actions.assertGateway(binding.leaseExpiresAt);
    backup = await actions.stage(candidate.config, candidate.configSha256);
    await actions.activate(backup);
    activated = true;
    await actions.test();
    await actions.reload();
    if (!persistent) {
      await actions.restore(backup);
      activated = false;
      await actions.test();
      await actions.reload();
    }
  } catch {
    if (activated) {
      try {
        if (
          actions.isActiveCandidate &&
          !(await actions.isActiveCandidate(backup))
        )
          throw new Error('candidate drift');
        await actions.restore(backup);
        await actions.test();
        await actions.reload();
      } catch {
        failure = new Error(
          'Managed Nginx activation failed; owner review required'
        );
      }
    }
    failure ??= new Error('Managed Nginx activation failed');
  }
  try {
    await actions.cleanup();
  } catch {
    throw new Error('Managed Nginx activation cleanup requires owner review');
  }
  if (failure) throw failure;
  return candidate;
}
