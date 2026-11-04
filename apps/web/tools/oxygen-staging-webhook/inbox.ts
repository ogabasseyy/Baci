import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, constants, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { OxygenWebhookEvent } from '../../src/lib/payments/oxygen/webhook';

/** Staging-only local inbox. No Baci order, ledger or provider state is changed. */
export function openStagingInbox(path: string, partner: string) {
  if (!partner.trim()) throw new Error('Partner required');
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const fd = openSync(
    path,
    constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW,
    0o600
  );
  closeSync(fd);
  chmodSync(path, 0o600);
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS inbox (
      scope TEXT NOT NULL, event_key TEXT NOT NULL, kind TEXT NOT NULL,
      payload TEXT NOT NULL, received_at TEXT NOT NULL,
      PRIMARY KEY(scope, event_key)
    );`);
  const scope = `staging:${createHash('sha256').update(partner).digest('hex')}`;
  return {
    accept(event: OxygenWebhookEvent): Promise<'accepted' | 'duplicate'> {
      const key =
        'deduplicationKey' in event
          ? event.deduplicationKey
          : `address:${randomUUID()}`;
      const payload = JSON.stringify(event);
      db.exec('BEGIN IMMEDIATE');
      try {
        const old = db
          .prepare('SELECT payload FROM inbox WHERE scope=? AND event_key=?')
          .get(scope, key);
        if (old) {
          if (old.payload !== payload) throw new Error('Event conflict');
          db.exec('COMMIT');
          return Promise.resolve('duplicate');
        }
        db.prepare(
          'INSERT INTO inbox(scope,event_key,kind,payload,received_at) VALUES(?,?,?,?,?)'
        ).run(scope, key, event.kind, payload, new Date().toISOString());
        db.exec('COMMIT');
        return Promise.resolve('accepted');
      } catch (error) {
        db.exec('ROLLBACK');
        return Promise.reject(error);
      }
    },
    summary(): { kind: string; count: number }[] {
      return db
        .prepare(
          'SELECT kind,COUNT(*) AS count FROM inbox WHERE scope=? GROUP BY kind ORDER BY kind'
        )
        .all(scope)
        .map((row) => ({ kind: String(row.kind), count: Number(row.count) }));
    },
    close() {
      db.close();
    },
  };
}
