import { z } from 'zod';

export const walletDvaProvisionerRuntimeSchema = z.strictObject({
  database: z.strictObject({
    certificateAuthority: z.string().min(1).max(32768),
    host: z
      .string()
      .max(253)
      .regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/),
    login: z.literal('baci_wallet_dva_provisioner'),
    name: z
      .string()
      .min(1)
      .max(63)
      .regex(/^[a-z][a-z0-9_]*$/),
    password: z.string().min(1).max(4096),
    port: z.int().min(1).max(65535),
  }),
});

export type WalletDvaProvisionerRuntime = z.infer<
  typeof walletDvaProvisionerRuntimeSchema
>;

export function readWalletDvaProvisionerRuntime(
  env: Record<string, string | undefined> = process.env
): WalletDvaProvisionerRuntime | null {
  if (env.WALLET_DVA_PROVISIONER_ENABLED !== 'true') return null;

  const parsed = walletDvaProvisionerRuntimeSchema.safeParse({
    database: {
      certificateAuthority: env.WALLET_DVA_PROVISIONER_DB_CA,
      host: env.WALLET_DVA_PROVISIONER_DB_HOST,
      login: 'baci_wallet_dva_provisioner',
      name: env.WALLET_DVA_PROVISIONER_DB_NAME,
      password: env.WALLET_DVA_PROVISIONER_DB_PASSWORD,
      port: Number(env.WALLET_DVA_PROVISIONER_DB_PORT),
    },
  });

  return parsed.success ? parsed.data : null;
}
