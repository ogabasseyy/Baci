import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runProductionOldCancellationProof } from './run-production-old-cancellation-proof';

const repositoryRoot = path.resolve(import.meta.dirname, '../../../..');
const oldSha =
  '6155b28720d0f4a8a20746aa1a2365e631249e940fa7339e0e19b66c28fa1e62';
const repairedSha =
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const proofOptions = {
  databaseUrl: 'postgresql://postgres:secret@127.0.0.1:41001/postgres',
  environment: {},
  psqlBin: 'psql',
  repositoryRoot,
};

function proofFixture() {
  const exchanged: string[] = [];
  const session = {
    exchange: vi.fn((input: string) => {
      exchanged.push(input);
      const beginMarker = /\\echo (__BACI_[A-Z0-9_]+__)/.exec(input)?.[1];
      if (!beginMarker) throw new Error('missing test marker');
      if (exchanged.length === 2) return Promise.resolve('');
      const stage = exchanged.length === 1 ? 'old' : 'repaired';
      return Promise.resolve(`${beginMarker}\n{"stage":"${stage}"}\n`);
    }),
    rollbackAndClose: vi.fn(() => Promise.resolve()),
  };
  const dependencies = {
    createMarker: vi
      .fn()
      .mockReturnValueOnce('__BACI_OLD_BEGIN__')
      .mockReturnValueOnce('__BACI_OLD_END__')
      .mockReturnValueOnce('__BACI_OLD_PROBE_BEGIN__')
      .mockReturnValueOnce('__BACI_OLD_PROBE_END__')
      .mockReturnValueOnce('__BACI_REPAIRED_BEGIN__')
      .mockReturnValueOnce('__BACI_REPAIRED_END__'),
    createSession: vi.fn(
      (_options: {
        environment: Partial<NodeJS.ProcessEnv>;
        psqlBin: string;
      }) => session
    ),
    readCancellationDigest: vi.fn((snapshot: string) =>
      snapshot.includes('"old"') ? oldSha : repairedSha
    ),
    resolveSource: vi.fn((root: string, repositoryPath: string) =>
      Promise.resolve(path.join(root, repositoryPath))
    ),
  };
  return { dependencies, exchanged, session };
}

describe('runProductionOldCancellationProof', () => {
  it('does not send probes or repair bytes before the immutable old digest matches', async () => {
    const fixture = proofFixture();

    await expect(
      runProductionOldCancellationProof(
        {
          databaseUrl: 'postgresql://postgres:secret@127.0.0.1:41001/postgres',
          environment: {},
          psqlBin: '/opt/homebrew/opt/libpq/bin/psql',
          repositoryRoot,
        },
        fixture.dependencies
      )
    ).resolves.toEqual({
      productionSha256: oldSha,
      repairedSha256: repairedSha,
      verified: true,
    });

    expect(fixture.exchanged).toHaveLength(3);
    expect(fixture.exchanged[0]).toContain('BEGIN;');
    expect(fixture.exchanged[0]).toContain(
      'production_old_cancel_order_as_customer.sql'
    );
    expect(fixture.exchanged[0]).toContain('baci-p0-effects-v3');
    expect(fixture.exchanged[0]).not.toContain(
      'assert_production_old_cancel_order_as_customer.sql'
    );
    expect(fixture.exchanged[0]).not.toContain('20260714225503');
    expect(fixture.exchanged[1]).toContain(
      'assert_production_old_cancel_order_as_customer.sql'
    );
    expect(fixture.exchanged[1]).not.toContain('20260714225503');
    expect(fixture.exchanged[2]).toContain('20260714225503');
    expect(fixture.exchanged[2]).toContain(
      'assert_repaired_cancel_order_as_customer.sql'
    );
    expect(fixture.dependencies.createSession).toHaveBeenCalledWith({
      environment: {},
      psqlBin: '/opt/homebrew/opt/libpq/bin/psql',
    });
    expect(
      fixture.dependencies.createSession.mock.calls[0]?.[0]
    ).not.toHaveProperty('databaseUrl');
    expect(fixture.session.rollbackAndClose).toHaveBeenCalledOnce();
  });

  it('rolls back without sending probes when the old digest mismatches', async () => {
    const fixture = proofFixture();
    fixture.dependencies.readCancellationDigest.mockReturnValue(repairedSha);

    await expect(
      runProductionOldCancellationProof(
        {
          databaseUrl: 'postgresql://postgres:secret@127.0.0.1:41001/postgres',
          environment: {},
          psqlBin: 'psql',
          repositoryRoot,
        },
        fixture.dependencies
      )
    ).rejects.toThrow(
      /^Production-old cancellation proof failed: old-digest-mismatch$/
    );

    expect(fixture.exchanged).toHaveLength(1);
    expect(fixture.session.rollbackAndClose).toHaveBeenCalledOnce();
  });

  it('reports the deliberate Task 5 red boundary only after the old digest handshake', async () => {
    const fixture = proofFixture();
    fixture.dependencies.resolveSource.mockImplementation(
      (root: string, repositoryPath: string) => {
        if (repositoryPath.includes('20260714225503')) {
          return Promise.reject(new Error('missing path with secret'));
        }
        return Promise.resolve(path.join(root, repositoryPath));
      }
    );

    await expect(
      runProductionOldCancellationProof(
        {
          databaseUrl: 'postgresql://postgres:secret@127.0.0.1:41001/postgres',
          environment: {},
          psqlBin: 'psql',
          repositoryRoot,
        },
        fixture.dependencies
      )
    ).rejects.toThrow(
      /^Production-old cancellation proof failed: repair-not-materialized$/
    );

    expect(fixture.exchanged).toHaveLength(2);
    expect(fixture.session.rollbackAndClose).toHaveBeenCalledOnce();
  });

  it.each([
    ['missing', 'not-the-expected-marker\n'],
    ['duplicate', '__BACI_OLD_BEGIN__\n{}\n__BACI_OLD_BEGIN__\n'],
  ])('rejects a %s snapshot marker without sending probes', async (_, output) => {
    const fixture = proofFixture();
    fixture.session.exchange.mockResolvedValueOnce(output);

    await expect(
      runProductionOldCancellationProof(proofOptions, fixture.dependencies)
    ).rejects.toThrow(
      /^Production-old cancellation proof failed: invalid-snapshot$/
    );
    expect(fixture.exchanged).toEqual([]);
    expect(fixture.session.rollbackAndClose).toHaveBeenCalledOnce();
  });

  it('rejects malformed snapshot JSON without exposing it', async () => {
    const fixture = proofFixture();
    const raw = 'CREATE FUNCTION secret_definition()';
    fixture.session.exchange.mockResolvedValueOnce(
      `__BACI_OLD_BEGIN__\n${raw}\n`
    );

    let failure: unknown;
    try {
      await runProductionOldCancellationProof(proofOptions, {
        ...fixture.dependencies,
        readCancellationDigest: undefined,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      'Production-old cancellation proof failed: invalid-snapshot'
    );
    expect((failure as Error).message).not.toContain(raw);
    expect(fixture.session.rollbackAndClose).toHaveBeenCalledOnce();
  });

  it('rejects a repair that leaves the cancellation component digest unchanged', async () => {
    const fixture = proofFixture();
    fixture.dependencies.readCancellationDigest.mockReturnValue(oldSha);

    await expect(
      runProductionOldCancellationProof(proofOptions, fixture.dependencies)
    ).rejects.toThrow(
      /^Production-old cancellation proof failed: repaired-digest-mismatch$/
    );
    expect(fixture.exchanged).toHaveLength(3);
    expect(fixture.session.rollbackAndClose).toHaveBeenCalledOnce();
  });

  it('sanitizes source and path failures without exposing definitions or credentials', async () => {
    const raw = 'CREATE FUNCTION leaked_definition() password=database-secret';
    const fixture = proofFixture();

    let sourceFailure: unknown;
    try {
      await runProductionOldCancellationProof(proofOptions, {
        ...fixture.dependencies,
        readSource: vi.fn(() => Promise.reject(new Error(raw))),
      });
    } catch (error) {
      sourceFailure = error;
    }
    expect((sourceFailure as Error).message).toBe(
      'Production-old cancellation proof failed: verification-failed'
    );
    expect((sourceFailure as Error).message).not.toContain(raw);

    fixture.dependencies.resolveSource.mockResolvedValue(
      `/tmp/unsafe path/${raw}`
    );
    let pathFailure: unknown;
    try {
      await runProductionOldCancellationProof(
        proofOptions,
        fixture.dependencies
      );
    } catch (error) {
      pathFailure = error;
    }
    expect((pathFailure as Error).message).toBe(
      'Production-old cancellation proof failed: unsafe-source'
    );
    expect((pathFailure as Error).message).not.toContain(raw);
  });
});
