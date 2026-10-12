import { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('pg', () => ({ Client: vi.fn() }));

import { createPiggyvestPostgresExecutor } from './postgres-executor';
import { postgresExecutorFixture } from './postgres-executor.test-support';
import { PIGGYVEST_POSTGRES_STATEMENTS as statements } from './postgres-statements';

let fixture: ReturnType<typeof postgresExecutorFixture>;
function createMockClient(): Client {
  return fixture.client as unknown as Client;
}
function rejectClientConstruction(): never {
  throw new Error('synthetic-private-password');
}
const parameters = [
  '11111111-1111-4111-8111-111111111111',
  'synthetic-event',
  Buffer.from('{}'),
];
beforeEach(() => {
  vi.clearAllMocks();
  fixture = postgresExecutorFixture();
  vi.mocked(Client).mockImplementation(createMockClient);
});
afterEach(() => vi.useRealTimers());

describe('PostgreSQL uncertainty and redaction', () => {
  it('redacts constructor failures instead of exposing driver configuration', async () => {
    vi.mocked(Client).mockImplementation(rejectClientConstruction);
    await expect(
      createPiggyvestPostgresExecutor(fixture.configuration)(
        statements.enqueueInbox.text,
        parameters
      )
    ).rejects.toThrow(/^PiggyVest database unavailable$/);
  });

  it.each([
    'COMMIT',
    statements.enqueueInbox.text,
  ])('never retries after failure at %s', async (failurePoint) => {
    const query = fixture.client.query.getMockImplementation();
    fixture.client.query.mockImplementation(async (statement, values) => {
      if (statement === failurePoint)
        throw new Error('synthetic-private-response');
      if (!query) throw new Error('Missing synthetic query');
      return query(statement, values);
    });
    await expect(
      createPiggyvestPostgresExecutor(fixture.configuration)(
        statements.enqueueInbox.text,
        parameters
      )
    ).rejects.toThrow(/^PiggyVest database unavailable$/);
    expect(
      fixture.client.query.mock.calls.filter(
        ([statement]) => statement === failurePoint
      )
    ).toHaveLength(1);
    expect(Client).toHaveBeenCalledOnce();
    expect(fixture.client.end).toHaveBeenCalledOnce();
  });

  it.each([
    'ROLLBACK',
    'UNKNOWN',
  ])('does not accept a %s response as committed', async (command) => {
    const query = fixture.client.query.getMockImplementation();
    fixture.client.query.mockImplementation(async (statement, values) => {
      if (statement === 'COMMIT') return { command, rows: [] };
      if (!query) throw new Error('Missing synthetic query');
      return query(statement, values);
    });
    await expect(
      createPiggyvestPostgresExecutor(fixture.configuration)(
        statements.enqueueInbox.text,
        parameters
      )
    ).rejects.toThrow();
  });

  it('requires the driver idle state after COMMIT', async () => {
    fixture.client.getTransactionStatus.mockReturnValue('T');
    await expect(
      createPiggyvestPostgresExecutor(fixture.configuration)(
        statements.enqueueInbox.text,
        parameters
      )
    ).rejects.toThrow();
  });

  it('bounds a hung connection and does not await nonsettling cleanup', async () => {
    vi.useFakeTimers();
    const connected = Promise.withResolvers<void>();
    fixture.client.connect.mockReturnValue(connected.promise);
    fixture.client.end.mockReturnValue(new Promise(() => undefined));
    const result = createPiggyvestPostgresExecutor(fixture.configuration)(
      statements.enqueueInbox.text,
      parameters
    ).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await result).toMatchObject({
      message: 'PiggyVest database unavailable',
    });
    connected.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(fixture.client.query).not.toHaveBeenCalled();
    expect(fixture.client.end).toHaveBeenCalledOnce();
  });

  it('does not commit when a query completes after the overall deadline', async () => {
    vi.useFakeTimers();
    const completed = Promise.withResolvers<{ command: string; rows: [] }>();
    const started = Promise.withResolvers<void>();
    const query = fixture.client.query.getMockImplementation();
    fixture.client.query.mockImplementation(async (statement, values) => {
      if (statement === statements.enqueueInbox.text) {
        started.resolve();
        return completed.promise;
      }
      if (!query) throw new Error('Missing synthetic query');
      return query(statement, values);
    });
    const result = createPiggyvestPostgresExecutor(fixture.configuration)(
      statements.enqueueInbox.text,
      parameters
    ).catch((error: unknown) => error);
    await started.promise;
    await vi.advanceTimersByTimeAsync(5000);
    expect(await result).toMatchObject({
      message: 'PiggyVest database unavailable',
    });
    completed.resolve({ command: 'SELECT', rows: [] });
    await Promise.resolve();
    await Promise.resolve();
    expect(fixture.client.query).not.toHaveBeenCalledWith('COMMIT');
  });
});
