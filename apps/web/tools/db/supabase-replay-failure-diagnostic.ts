export function supabaseReplayFailureDiagnostic(stderr: string): string {
  const sqlstate = /\bSQLSTATE[\s:=]+([0-9A-Z]{5})\b/.exec(stderr)?.[1];
  if (sqlstate) return ` (diagnostic=postgres-${sqlstate})`;
  const patterns = [
    ['connection-refused', /connection refused/i],
    ['port-conflict', /address already in use|port is already allocated/i],
    ['docker-api', /client version.*too old|minimum supported API version/i],
    ['disk-full', /no space left on device/i],
    [
      'image-pull',
      /failed to pull|pull access denied|failed to resolve reference|toomanyrequests/i,
    ],
    ['container-create', /failed to create docker container/i],
    ['container-health', /unhealthy|health check failed/i],
  ] as const;
  const diagnostic = patterns.find(([, pattern]) => pattern.test(stderr))?.[0];
  return diagnostic ? ` (diagnostic=${diagnostic})` : '';
}
