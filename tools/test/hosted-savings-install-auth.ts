import { z } from 'zod';

const principal = z
  .object({
    name: z.string(),
    oid: z.number().int().positive().optional(),
    superuser: z.boolean(),
    bypassRls: z.boolean(),
    createRole: z.boolean(),
    createDb: z.boolean(),
    replication: z.boolean(),
    login: z.boolean(),
  })
  .strict();
const membership = z
  .object({
    role: z.string(),
    member: z.string(),
    grantor: z.string(),
    adminOption: z.boolean(),
    inheritOption: z.boolean(),
    setOption: z.boolean(),
  })
  .strict();
const snapshot = z
  .object({
    data: z.record(z.string(), z.string()),
    roles: z.string(),
    schema: z.string(),
    principals: z.array(principal),
    memberships: z.array(membership),
  })
  .strict();

export function assertHostedSavingsAuthPreserved(
  beforeText: string,
  afterText: string,
  allowed: readonly { role: string; member: string }[] = []
) {
  const before = snapshot.parse(JSON.parse(beforeText));
  const after = snapshot.parse(JSON.parse(afterText));
  const canonical = (value: Record<string, string>) =>
    JSON.stringify(Object.entries(value).sort());
  if (
    canonical(before.data) !== canonical(after.data) ||
    before.roles !== after.roles ||
    before.schema !== after.schema
  )
    throw new Error('Protected Auth data or roles changed');
  const edgeKey = (edge: z.infer<typeof membership>) => JSON.stringify(edge);
  const originalEdges = new Set(before.memberships.map(edgeKey));
  const currentEdges = new Set(after.memberships.map(edgeKey));
  if ([...originalEdges].some((edge) => !currentEdges.has(edge)))
    throw new Error('Preexisting membership changed');
  const originalRoles = new Set(before.principals.map((role) => role.name));
  const currentRoles = new Map(
    after.principals.map((role) => [role.name, role])
  );
  for (const edge of after.memberships) {
    if (originalEdges.has(edgeKey(edge))) continue;
    if (
      !allowed.some(
        (reviewed) =>
          reviewed.role === edge.role && reviewed.member === edge.member
      ) ||
      edge.adminOption
    )
      throw new Error('Unreviewed membership addition');
    const originalGrantor = before.principals.find(
      (role) => role.name === edge.grantor
    );
    const trustedSupabaseGrantor =
      edge.grantor === 'supabase_admin' &&
      originalGrantor?.oid === 10 &&
      originalGrantor?.superuser === true &&
      JSON.stringify(originalGrantor) ===
        JSON.stringify(currentRoles.get(edge.grantor));
    for (const name of [edge.role, edge.member]) {
      const role = currentRoles.get(name);
      const reviewedAuthenticator =
        name === edge.member &&
        name === 'authenticator' &&
        edge.role === 'repair_pickup_receiver' &&
        (edge.grantor === 'postgres' || trustedSupabaseGrantor) &&
        !edge.inheritOption &&
        edge.setOption &&
        originalRoles.has(name);
      if (reviewedAuthenticator) continue;
      if (
        originalRoles.has(name) ||
        /^(?:pg_|supabase_)/.test(name) ||
        [
          'postgres',
          'anon',
          'authenticated',
          'service_role',
          'authenticator',
        ].includes(name) ||
        !role ||
        role.superuser ||
        role.bypassRls ||
        role.createRole ||
        role.createDb ||
        role.replication ||
        role.login
      )
        throw new Error('Membership reaches preexisting or elevated principal');
    }
  }
}
