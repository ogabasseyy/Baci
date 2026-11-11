import { expect, it, vi } from 'vitest';
import { runVerifierTransaction } from './verifier-transaction';

it('commits a proof write under the restricted verifier role and returns its value', async () => {
  const query = vi.fn(async (_sql: string) => ({}));
  const write = vi.fn(async () => 'synthetic proof');
  await expect(runVerifierTransaction({ query }, write)).resolves.toBe(
    'synthetic proof'
  );
  expect(query.mock.calls.map(([sql]) => sql)).toEqual([
    'BEGIN',
    'SET LOCAL ROLE baci_experience_verifier',
    'COMMIT',
  ]);
});
it('rolls back a failed role switch before propagating the original error', async () => {
  const failure = Error('synthetic verifier denied');
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith('SET LOCAL ROLE')) throw failure;
    return {};
  });
  const write = vi.fn(async () => undefined);
  await expect(runVerifierTransaction({ query }, write)).rejects.toBe(failure);
  expect(query.mock.calls.map(([sql]) => sql)).toEqual([
    'BEGIN',
    'SET LOCAL ROLE baci_experience_verifier',
    'ROLLBACK',
  ]);
  expect(write).not.toHaveBeenCalled();
});
