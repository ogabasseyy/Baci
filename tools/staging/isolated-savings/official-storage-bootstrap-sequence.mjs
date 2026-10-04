export async function storageBootstrapSequence(actions) {
  let failure = false;
  try {
    await actions.prepare();
    await actions.migrate();
  } catch {
    failure = true;
  } finally {
    try {
      await actions.lockdown();
    } catch {
      failure = true;
    }
    try {
      await actions.stop();
    } catch {
      failure = true;
    }
  }
  if (failure) throw new Error('Bootstrap failed; verify initializer lockdown through the admin channel');
  await actions.verify();
}
