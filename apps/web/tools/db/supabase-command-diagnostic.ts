/** Return fixed failure labels only; subprocess output may contain credentials. */
export function supabaseCommandDiagnostic(output: string): string {
  const state = /\bSQLSTATE[ :]+([0-9A-Z]{5})\b/.exec(output)?.[1];
  if (state) return ` (sqlstate=${state})`;
  const categories: readonly [RegExp, string][] = [
    [
      /Cannot connect to the Docker daemon|docker daemon is not running/i,
      'docker-unavailable',
    ],
    [/address already in use|port is already allocated/i, 'port-conflict'],
    [
      /manifest unknown|manifest.*not found|failed to pull|pull access denied|toomanyrequests/i,
      'image-pull',
    ],
    [/no space left on device/i, 'disk-full'],
    [/failed to parse config|invalid config/i, 'invalid-config'],
    [/connection refused/i, 'connection-refused'],
  ];
  for (const [pattern, category] of categories) {
    if (pattern.test(output)) return ` (reason=${category})`;
  }
  return '';
}
