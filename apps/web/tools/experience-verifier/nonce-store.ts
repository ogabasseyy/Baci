import type { Pool } from 'pg';
import { verifyVerifierDatabaseRole } from './database-role';

/** Shared durable nonce admission for the separate verifier service. */
export async function createVerifierNonceStore(pool: Pool, now = Date.now) {
  await verifyVerifierDatabaseRole(pool);
  return async (nonce: string, expiresAt: number): Promise<boolean> => {
    const time = now();
    if (
      !/^[a-f0-9]{64}$/.test(nonce) ||
      !Number.isSafeInteger(expiresAt) ||
      expiresAt <= time ||
      expiresAt > time + 60000
    )
      throw Error('INVALID_VERIFIER_NONCE');
    await pool.query(
      'DELETE FROM experience_authorization.verifier_nonces WHERE expires_at <= statement_timestamp()'
    );
    const result = await pool.query(
      'INSERT INTO experience_authorization.verifier_nonces(nonce,expires_at) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [Buffer.from(nonce, 'hex'), new Date(expiresAt)]
    );
    return result.rowCount === 1;
  };
}
