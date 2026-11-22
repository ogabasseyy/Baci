// These factories use the caller's Zod runtime so the standalone broker still
// works with only its own installed dependencies.
type Zod = typeof import('zod').z;

export function builderAuthOperatorSchema(
  z: Zod,
  minConnectionTtl: number,
  maxConnectionTtl: number
) {
  const bytes32 = z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/)
    .refine((value) => {
      const bytes = Buffer.from(value, 'base64url');
      return bytes.length === 32 && bytes.toString('base64url') === value;
    });
  const privateKey = z.strictObject({
    kty: z.literal('EC'),
    crv: z.literal('P-256'),
    x: bytes32,
    y: bytes32,
    d: bytes32,
    alg: z.literal('ES256'),
    kid: z.string().min(1).max(100),
  });
  return z.strictObject({
    databaseUrl: z.string().min(1).max(4096),
    socketPath: z.string().min(1).max(100),
    clientId: z.literal('baci-chatgpt-builder-v1'),
    callback: z.string().url(),
    cookieKeys: z.array(z.string().min(32).max(256)).min(1).max(3),
    signingKeys: z.array(privateKey).min(1).max(3),
    vault: z.strictObject({
      activeKeyId: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
      keys: z.record(z.string().regex(/^[A-Za-z0-9_-]{1,40}$/), bytes32),
    }),
    upstream: z.strictObject({
      issuer: z.string().url(),
      clientId: z.string().min(1).max(256),
      clientSecret: z.string().min(16).max(1024),
    }),
    supabase: z.strictObject({
      url: z.string().url(),
      anonKey: z.string().min(1).max(8192),
    }),
    connectionTtlSeconds: z
      .number()
      .int()
      .min(minConnectionTtl)
      .max(maxConnectionTtl),
  });
}

export function builderAuthDiscoverySchemas(z: Zod) {
  const uuid = z.uuid();
  const connection = z.object({
    connectionId: uuid,
    actorUserId: uuid,
    grantVersion: z.number().int().positive().safe(),
    status: z.literal('active'),
    expiresAt: z.string(),
    revokedAt: z.null(),
    scopes: z.array(z.string()),
    allowedMerchantIds: z.array(uuid).max(1),
  });
  return { uuid, connection, ids: z.array(uuid).max(20) };
}
