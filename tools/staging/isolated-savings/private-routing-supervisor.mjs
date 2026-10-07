import { generatePrivateRouting } from './private-routing.mjs';

export async function supervisePrivateRouting(input, actions, signal) {
  let child;
  const render = (inventory) =>
    generatePrivateRouting(
      input.receipt,
      inventory,
      actions.now(),
      'unprivileged-test'
    ).config;
  try {
    const config = render(input.inventory);
    if (signal.aborted || !actions.parentAlive())
      throw new Error('Supervisor cancelled');
    if (render(await actions.inventory()) !== config)
      throw new Error('Routing changed');
    await actions.prepare(config, signal);
    if (
      render(await actions.inventory()) !== config ||
      signal.aborted ||
      !actions.parentAlive()
    )
      throw new Error('Routing changed');
    child = await actions.start(signal);
    while (!signal.aborted && actions.parentAlive()) {
      if (!child.alive() || render(await actions.inventory()) !== config)
        throw new Error('Routing withdrawn');
      await Promise.race([
        actions.pause(signal),
        child.exited.then(() => {
          throw new Error('Owned nginx exited');
        }),
      ]);
    }
  } finally {
    try {
      if (child) await actions.stop(child);
    } finally {
      await actions.cleanup();
    }
  }
}
