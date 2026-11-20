import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { Pool } from 'pg';
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { startVerifierService } from '../../tools/experience-verifier/service';
import { experienceDataFixture } from './data-fixture.test-support';

it('starts the real service with a restricted local role and rejects unsigned requests', async () => {
  const f = await experienceDataFixture();
  let pool: Pool | undefined;
  let service: Awaited<ReturnType<typeof startVerifierService>> | undefined;
  try {
    if (!f.db.localDatabase) throw Error('LOCAL_DATABASE_REQUIRED');
    await f.db.pool.query(
      readFileSync(
        new URL(
          '../../../../supabase/migrations/20261111232000_experience_verifier_nonces.sql',
          import.meta.url
        ),
        'utf8'
      )
    );
    await f.db.pool.query(
      'CREATE ROLE baci_experience_verifier_login LOGIN NOINHERIT; GRANT baci_experience_verifier TO baci_experience_verifier_login'
    );
    pool = new Pool({
      host: f.db.localDatabase.socketDirectory,
      user: 'baci_experience_verifier_login',
      database: 'postgres',
      options: '-c role=baci_experience_verifier',
    });
    const reservation = createServer();
    reservation.listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const address = reservation.address();
    if (!address || typeof address === 'string') throw Error('NO_PORT');
    const port = address.port;
    await new Promise<void>((resolve, reject) =>
      reservation.close((error) => (error ? reject(error) : resolve()))
    );
    const settings = {
      pool,
      port,
      key: new Uint8Array(32).fill(1),
      runner: {
        endpoint: 'https://runner.runtime.test/v1/execute',
        key: new Uint8Array(32).fill(2),
        toolchainDigest: 'a'.repeat(64),
      },
      previewOrigin: 'https://builder.baci.test',
      executionOrigin: 'https://output.runtime.test',
      supabase: {
        url: 'https://project.supabase.co',
        anonKey: 'sb_publishable_synthetic',
      },
      canonicalBase: (slug: string) => `https://${slug}.merchant.test/${slug}`,
    };
    await expect(
      startVerifierService({ ...settings, pool: f.db.pool })
    ).rejects.toThrow('UNSAFE_VERIFIER_DATABASE_SESSION');
    service = await startVerifierService(settings);
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port,
          path: '/v1/attest',
          method: 'POST',
          headers: {
            host: 'verifier.baci-internal.invalid',
            'content-type': 'application/json',
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        }
      );
      req.on('error', reject);
      req.end(
        JSON.stringify({
          version: 1,
          nonce: 'a'.repeat(64),
          expiresAt: Date.now() + 30000,
          accessToken: 'synthetic.token',
          approvalId: '11111111-1111-4111-8111-111111111111',
          kind: 'draft',
        })
      );
    });
    expect(status).toBe(401);
  } finally {
    await service?.close();
    await pool?.end();
    await f.close();
  }
}, 60000);
