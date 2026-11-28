import { z } from 'zod';

export const domainLifecycleWriterRuntimeSchema = z.strictObject({
  database: z.strictObject({
    certificateAuthority: z.string().min(1).max(32768),
    host: z
      .string()
      .max(253)
      .regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/),
    login: z.literal('baci_domain_lifecycle_provisioner'),
    name: z
      .string()
      .min(1)
      .max(63)
      .regex(/^[a-z][a-z0-9_]*$/),
    password: z.string().min(1).max(4096),
    port: z.int().min(1).max(65535),
  }),
});

export type DomainLifecycleWriterRuntime = z.infer<
  typeof domainLifecycleWriterRuntimeSchema
>;

export function readDomainLifecycleWriterRuntime(
  env: Record<string, string | undefined> = process.env
): DomainLifecycleWriterRuntime | null {
  if (env.DOMAIN_LIFECYCLE_WRITER_ENABLED !== 'true') return null;

  const parsed = domainLifecycleWriterRuntimeSchema.safeParse({
    database: {
      certificateAuthority: env.DOMAIN_LIFECYCLE_WRITER_DB_CA,
      host: env.DOMAIN_LIFECYCLE_WRITER_DB_HOST,
      login: 'baci_domain_lifecycle_provisioner',
      name: env.DOMAIN_LIFECYCLE_WRITER_DB_NAME,
      password: env.DOMAIN_LIFECYCLE_WRITER_DB_PASSWORD,
      port: Number(env.DOMAIN_LIFECYCLE_WRITER_DB_PORT),
    },
  });

  return parsed.success ? parsed.data : null;
}
