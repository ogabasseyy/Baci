import { readProtectedReplayFile } from './replay-protected-file';

export async function readReplayConfiguration(
  read = readProtectedReplayFile
): Promise<unknown> {
  try {
    const bytes = await read({
      path: '/run/pvb-replay/config.json',
      maximumBytes: 131_072,
      allowedModes: [0o400, 0o440, 0o600],
    });
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error('Staging replay configuration unavailable');
  }
}
