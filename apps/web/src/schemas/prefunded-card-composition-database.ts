import { z } from 'zod';
import { prefundedCardPostgresExecutorSchema } from './prefunded-card-postgres-executor';

type Database = z.output<typeof prefundedCardPostgresExecutorSchema>;

function profile(profileName: 'worker' | 'evidence' | 'authorizer') {
  return z.record(z.string(), z.unknown()).transform((input, context) => {
    if (Object.hasOwn(input, 'profile')) {
      context.addIssue({ code: 'custom', message: 'Invalid composition' });
      return z.NEVER;
    }
    const parsed = prefundedCardPostgresExecutorSchema.safeParse({
      ...input,
      profile: profileName,
    });
    if (!parsed.success) {
      context.addIssue({ code: 'custom', message: 'Invalid composition' });
      return z.NEVER;
    }
    return parsed.data;
  });
}

function samePhysicalIdentity(expected: Database, actual: Database) {
  if (
    actual.expectedSystemId !== expected.expectedSystemId ||
    actual.database !== expected.database ||
    actual.expectedDatabase !== expected.expectedDatabase ||
    actual.port !== expected.port
  )
    return false;
  if (actual.transport === 'local_test' && expected.transport === 'local_test')
    return actual.socketDirectory === expected.socketDirectory;
  if (actual.transport === 'tls' && expected.transport === 'tls')
    return (
      actual.host === expected.host &&
      actual.expectedHost === expected.expectedHost &&
      actual.expectedProjectId === expected.expectedProjectId &&
      actual.actualProjectId === expected.actualProjectId &&
      actual.certificateAuthority === expected.certificateAuthority
    );
  return false;
}

export const prefundedCardCompositionDatabase = {
  profile,
  samePhysicalIdentity,
};
