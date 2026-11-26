import { readPrivateAuthConfig } from './private-config-file.ts';

/** Operator-only bridge; the production entry point supplies the fixed path. */
export async function launchProductionAuthFromFile<T>(
  path: string,
  start: (input: unknown) => Promise<T>
): Promise<T> {
  return await start(await readPrivateAuthConfig(path));
}
