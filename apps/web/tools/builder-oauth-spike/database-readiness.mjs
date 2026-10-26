import { setTimeout } from 'node:timers/promises';
/** initdb's temporary Unix socket must not qualify as the final TCP server. */
export async function waitForDatabase(
  docker,
  name,
  pause = () => setTimeout(150)
) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      docker('exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres');
      return;
    } catch {
      await pause();
    }
  }
  throw new Error('Local database TCP readiness timeout');
}
