import 'server-only';
import { buildPrefundedCardActivationConfig } from './prefunded-card-activation-config';
import { createPrefundedCardPostgresExecutor } from './prefunded-card-postgres-executor';
import { PrefundedCardPostgresFailure } from './prefunded-card-postgres-failure';
import { PREFUNDED_CARD_POSTGRES_STATEMENTS } from './prefunded-card-postgres-statements';

export async function verifyPrefundedCardRuntimeReadiness(
  input: unknown,
  now: Date = new Date()
) {
  const parsed = buildPrefundedCardActivationConfig(input, now);
  if (!parsed.ok) throw new Error('Runtime configuration refused');
  const database = parsed.configuration.background.database;
  const profiles = [
    { ...database.treasury, profile: 'worker' },
    { ...database.authorizer, profile: 'authorizer' },
    { ...database.ingestion, profile: 'evidence' },
  ] as const;
  let profile: (typeof profiles)[number]['profile'] = 'worker';
  try {
    for (const configuration of profiles) {
      profile = configuration.profile;
      const execute = createPrefundedCardPostgresExecutor(configuration);
      const result = await execute(
        PREFUNDED_CARD_POSTGRES_STATEMENTS.connectionReady.text,
        []
      );
      if (
        result.rows.length !== 1 ||
        JSON.stringify(result.rows[0]) !== JSON.stringify({ result: true })
      )
        throw new PrefundedCardPostgresFailure(profile, 'readiness-result');
    }
  } catch (error) {
    throw new Error('Restricted runtime connection refused', {
      cause:
        error instanceof PrefundedCardPostgresFailure
          ? error
          : new PrefundedCardPostgresFailure(
              profile,
              'executor-initialization'
            ),
    });
  }
  return {
    status: 'restricted-tls-ready',
    profiles: profiles.map(({ profile }) => profile),
    readOnly: true,
    cardPaymentsEnabled: false,
  } as const;
}
