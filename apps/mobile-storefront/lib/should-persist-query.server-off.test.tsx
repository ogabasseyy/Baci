import { describe, expect, it } from '@jest/globals';
import { shouldPersistQuery } from './should-persist-query';

const query = (queryKey: unknown[], status = 'success') =>
  ({ queryKey, state: { status } }) as unknown as Parameters<
    typeof shouldPersistQuery
  >[0];

describe('bugfix: the expanded wallet activity list survived an app relaunch', () => {
  it('never persists the wallet activity list', () => {
    expect(
      shouldPersistQuery(query(['piggyvest-wallet-activity', 'm', 'u']))
    ).toBe(false);
  });

  it('still persists other successful queries and skips failed ones', () => {
    expect(shouldPersistQuery(query(['products']))).toBe(true);
    expect(shouldPersistQuery(query(['products'], 'error'))).toBe(false);
  });
});
