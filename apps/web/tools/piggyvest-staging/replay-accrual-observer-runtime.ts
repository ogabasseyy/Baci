import { readAccrualObserverConfiguration } from './replay-accrual-observer-config';
import { createAccrualObserverPostgres } from './replay-accrual-observer-postgres';
import { createAccrualReplay } from './replay-accrual-runtime';

export async function createAccrualObserverReplay(
  input: Parameters<typeof readAccrualObserverConfiguration>[0]
) {
  try {
    const configuration = await readAccrualObserverConfiguration(input);
    const execute = await createAccrualObserverPostgres(configuration.observer);
    return createAccrualReplay(
      configuration.scope,
      configuration.signingSecret,
      execute
    );
  } catch {
    throw new Error('Staging accrual observer unavailable');
  }
}
