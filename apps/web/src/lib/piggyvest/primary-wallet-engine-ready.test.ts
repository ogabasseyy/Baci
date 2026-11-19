import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PRIMARY_ENGINE_READY_STATEMENT,
  readPrimaryEngineReady,
} from './primary-wallet-engine-ready';

vi.mock('server-only', () => ({}));

const query = vi.fn();
beforeEach(() => {
  query.mockReset();
});

describe('readPrimaryEngineReady', () => {
  it('asks the database once, for exactly the named surface', async () => {
    query.mockResolvedValue({
      rows: [{ result: { ready: true, missing: [] } }],
    });
    expect(await readPrimaryEngineReady(query, 'bank_inbox')).toEqual({
      ready: true,
      missing: [],
    });
    expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith(PRIMARY_ENGINE_READY_STATEMENT, [
      'bank_inbox',
    ]);
    expect(PRIMARY_ENGINE_READY_STATEMENT).toBe(
      'SELECT piggyvest_primary.engine_ready($1::text) AS result'
    );
  });

  it('reports the installed stub as not ready, with its missing marker', async () => {
    query.mockResolvedValue({
      rows: [
        {
          result: { ready: false, missing: ['engine_readiness_not_installed'] },
        },
      ],
    });
    expect(await readPrimaryEngineReady(query, 'inflow')).toEqual({
      ready: false,
      missing: ['engine_readiness_not_installed'],
    });
  });

  it('counts a database error as not ready and never throws', async () => {
    query.mockRejectedValue(
      new Error('function piggyvest_primary.engine_ready does not exist')
    );
    expect(await readPrimaryEngineReady(query, 'inflow')).toEqual({
      ready: false,
      missing: ['engine_readiness_unavailable'],
    });
  });

  it('counts a malformed or ambiguous answer as not ready', async () => {
    for (const rows of [
      [],
      [{ result: { ready: true, missing: [] } }, { result: { ready: true } }],
      [{ result: { ready: true, missing: ['heartbeat_stale'] } }],
      [{ result: { ready: 'true', missing: [] } }],
      [{ result: 'credited' }],
      [{}],
      [null],
    ]) {
      query.mockResolvedValueOnce({ rows });
      expect(await readPrimaryEngineReady(query, 'inflow')).toEqual({
        ready: false,
        missing: ['engine_readiness_unavailable'],
      });
    }
  });

  it('refuses an unknown surface without asking the database', async () => {
    expect(await readPrimaryEngineReady(query, 'everything' as never)).toEqual({
      ready: false,
      missing: ['engine_readiness_unavailable'],
    });
    expect(query).not.toHaveBeenCalled();
  });
});
