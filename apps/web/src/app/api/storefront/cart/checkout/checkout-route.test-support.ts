export function successfulCheckoutPayload(input: {
  grantExpiresAt: string;
  sessionExpiresAt: string;
  snapshot: unknown;
  replayed?: boolean;
  sessionReused?: boolean;
  databaseNow?: string;
}) {
  return {
    code: null,
    ok: true,
    grantExpiresAt: input.grantExpiresAt,
    replayed: input.replayed ?? false,
    databaseNow: input.databaseNow ?? new Date().toISOString(),
    sessionExpiresAt: input.sessionExpiresAt,
    sessionReused: input.sessionReused ?? false,
    snapshot: input.snapshot,
  };
}
