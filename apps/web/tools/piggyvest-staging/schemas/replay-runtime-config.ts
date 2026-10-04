import { z } from 'zod';
import { replayAccrualSigningSecretSchema } from './replay-accrual';
import { replayAccrualObserverSchemas } from './replay-accrual-observer';
import { replayFinancialSchemas } from './replay-financial';
import { replayPaidInterestSchemas } from './replay-paid-interest';
import { replayPrefundedSettings } from './replay-prefunded-settings';

const configSchema = z
  .object({
    environment: z.literal('staging'),
    receiptToken: z.string().min(1),
    appToken: z.string().min(1),
    receiptKey: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
    receiptSystemId: z.literal('7686901100561231906'),
    appSystemId: z.literal('7685292944002592802'),
    financialDatabase: replayFinancialSchemas.database.optional(),
    paidInterestDatabase: replayPaidInterestSchemas.database.optional(),
    accrualObserver: replayAccrualObserverSchemas.observer.optional(),
    interestAccrualSigningSecret: replayAccrualSigningSecretSchema.optional(),
    prefundedReplay: replayPrefundedSettings.activation.optional(),
  })
  .strict();

function hasRestrictedClaims(
  token: string,
  role: string,
  now: number
): boolean {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const claims: unknown = JSON.parse(
    Buffer.from(parts[1], 'base64url').toString('utf8')
  );
  const parsed = z
    .object({
      role: z.literal(role),
      iat: z
        .number()
        .int()
        .max(now + 60),
      exp: z
        .number()
        .int()
        .gt(now + 180),
    })
    .safeParse(claims);
  return parsed.success && parsed.data.exp - parsed.data.iat <= 7 * 24 * 3600;
}

export function parseReplayRuntimeConfig(
  input: unknown,
  now = Math.floor(Date.now() / 1000)
) {
  try {
    const config = configSchema.parse(input);
    if (
      !hasRestrictedClaims(config.receiptToken, 'pvb_staging_worker', now) ||
      !hasRestrictedClaims(config.appToken, 'pvb_staging_app_worker', now) ||
      (config.prefundedReplay !== undefined &&
        config.financialDatabase?.role === 'prefunded_treasury_operator') ||
      (config.interestAccrualSigningSecret !== undefined &&
        (!config.financialDatabase ||
          config.financialDatabase.role === 'prefunded_treasury_operator')) ||
      (config.paidInterestDatabase !== undefined &&
        (!config.prefundedReplay ||
          config.financialDatabase !== undefined ||
          config.interestAccrualSigningSecret !== undefined)) ||
      (config.accrualObserver !== undefined &&
        (!config.prefundedReplay ||
          !config.paidInterestDatabase ||
          config.financialDatabase !== undefined ||
          config.interestAccrualSigningSecret !== undefined ||
          config.accrualObserver.database.integrationId !==
            config.paidInterestDatabase.integrationId ||
          config.accrualObserver.database.businessId !==
            config.paidInterestDatabase.businessId)) ||
      Buffer.from(config.receiptKey, 'base64').length !== 32
    ) {
      throw new Error('Invalid configuration');
    }
    return config;
  } catch {
    throw new Error('Staging replay configuration refused');
  }
}
