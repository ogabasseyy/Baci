import { z } from 'zod';
import { replayAccrualSigningSecretSchema } from './replay-accrual';
import { replayPaidInterestSchemas } from './replay-paid-interest';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const role = z.literal('piggyvest_staging_ledger_worker');
const deadline = z.literal('2026-10-06T15:59:10Z');

export const replayAccrualObserverSchemas = {
  observer: z
    .strictObject({
      database: replayPaidInterestSchemas.database.extend({ role }),
      wrapperDefinitionSha256: hash,
      originalDefinitionSha256: hash,
      executionDeadline: deadline,
    })
    .refine((value) => Date.now() < Date.parse(value.executionDeadline)),
  parameters: z.tuple([
    z.uuid(),
    z.string().min(1).max(128),
    z.literal('7685292944002592802'),
    z.uuid(),
    hash,
    z
      .string()
      .min(1)
      .refine((value) => Buffer.byteLength(value, 'utf8') <= 65536),
  ]),
  factoryConfiguration: z.object({
    scope: replayPaidInterestSchemas.factoryConfiguration.shape.scope,
    evidence: z.object({
      integrationId: z.uuid(),
      systemIdentifier: z.literal('7685292944002592802'),
      webhookSecret: replayAccrualSigningSecretSchema,
    }),
  }),
  sessionRows: z
    .array(
      z.strictObject({
        login: role,
        role,
        database: z.literal('postgres'),
        readOnly: z.enum(['on', 'off']),
        tls: z.literal(true),
        unsafe: z.literal(false),
        expiresValid: z.literal(true),
        noMembership: z.literal(true),
      })
    )
    .length(1),
  identityRows: z
    .array(
      z.strictObject({
        result: z.strictObject({
          systemIdentifier: z.literal('7685292944002592802'),
          login: role,
          database: z.literal('postgres'),
        }),
      })
    )
    .length(1),
  authorityRows: z
    .array(
      z.strictObject({
        authorized: z.literal(true),
        restricted: z.literal(true),
        wrapperDefinitionSha256: hash,
        originalDefinitionSha256: hash,
      })
    )
    .length(1),
};
