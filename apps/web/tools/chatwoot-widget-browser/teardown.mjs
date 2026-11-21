import { rm } from 'node:fs/promises';

export async function teardown(state) {
  const { browser, frontServer, proxy, tempDir } = state;
  try {
    await browser?.close();
  } catch {
    console.error('Could not close the isolated browser process cleanly.');
  }
  if (frontServer?.listening) {
    await new Promise((resolve) => frontServer.close(resolve));
  }
  if (proxy && proxy.exitCode === null) {
    proxy.kill('SIGTERM');
    await new Promise((resolve) => {
      proxy.once('exit', resolve);
      setTimeout(resolve, 3000).unref();
    });
  }
  await rm(tempDir, { recursive: true, force: true });
}
