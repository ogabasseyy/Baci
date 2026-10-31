import { describe, expect, it } from 'vitest';
import { primaryCardTransferFixture as fixture } from './primary-wallet-card-transfer.test-fixture';
import {
  freshOutboxDatabaseState,
  outboxDatabaseQuery,
} from './primary-wallet-card-transfer-outbox.test-support';

const resultOf = (reply: { rows: unknown[] }) =>
  (reply.rows[0] as { result: unknown }).result;

describe('card transfer outbox storage twin', () => {
  it('starts every test from a ready, healthy row', () => {
    expect(freshOutboxDatabaseState()).toEqual({
      state: 'ready',
      failRecord: false,
      invalid: false,
      stuckSibling: false,
    });
  });

  it('answers the session check with the configured transfer login', async () => {
    const query = outboxDatabaseQuery(freshOutboxDatabaseState());
    const reply = await query('SELECT SESSION_USER AS login_name', []);
    expect(reply.rows[0]).toMatchObject({
      database_name: fixture.configuration.runtime.transfer.name,
      login_name: 'baci_primary_card_transfer',
      safe: true,
      tls: true,
    });
  });

  it('selects ready work, claims it once and records the outcome on its state', async () => {
    const database = freshOutboxDatabaseState();
    const query = outboxDatabaseQuery(database);
    expect(
      resultOf(await query('SELECT select_ready_transfers()', ['1']))
    ).toEqual({
      operationIds: [fixture.context.operationId],
      unknownCount: 0,
      dispatchingCount: 0,
    });
    expect(resultOf(await query('SELECT claim_transfer()', []))).toEqual({
      outcome: 'claimed',
      token: fixture.context.customerId,
      command: fixture.command,
    });
    expect(database.state).toBe('dispatching');
    expect(resultOf(await query('SELECT claim_transfer()', []))).toEqual({
      outcome: 'existing',
    });
    expect(resultOf(await query('SELECT record_transfer()', [false]))).toBe(
      true
    );
    expect(database.state).toBe('unknown');
    expect(
      resultOf(await query('SELECT select_ready_transfers()', ['1']))
    ).toEqual({ operationIds: [], unknownCount: 1, dispatchingCount: 0 });
  });

  it('rejects, rather than throws, when recording is set to fail', async () => {
    const database = { ...freshOutboxDatabaseState(), failRecord: true };
    const reply = outboxDatabaseQuery(database)('SELECT record_transfer()', [
      true,
    ]);
    await expect(reply).rejects.toThrow('private storage detail');
  });
});
