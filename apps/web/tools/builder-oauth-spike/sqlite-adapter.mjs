/** Disposable local persistence proof; not a production adapter. */
import { DatabaseSync } from 'node:sqlite';
export function createAdapter(file, InvalidGrant) {
  const db = new DatabaseSync(file);
  db.exec(
    'PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS models (model TEXT, id TEXT, payload TEXT, expires INTEGER, PRIMARY KEY(model,id))'
  );
  const find = (model, id) => {
    const row = db
      .prepare(
        'SELECT payload FROM models WHERE model=? AND id=? AND expires>?'
      )
      .get(model, id, Date.now());
    return row ? JSON.parse(row.payload) : undefined;
  };
  return {
    close: () => db.close(),
    adapter: class {
      constructor(model) {
        this.model = model;
      }
      find(id) {
        return find(this.model, id);
      }
      findByUid(uid) {
        return this.by('uid', uid);
      }
      findByUserCode(code) {
        return this.by('userCode', code);
      }
      by(key, value) {
        const row = db
          .prepare(
            'SELECT payload FROM models WHERE model=? AND json_extract(payload,?)=? AND expires>?'
          )
          .get(this.model, `$.${key}`, value, Date.now());
        return row ? JSON.parse(row.payload) : undefined;
      }
      upsert(id, payload, expiresIn) {
        db.prepare(
          'INSERT INTO models VALUES (?,?,?,?) ON CONFLICT(model,id) DO UPDATE SET payload=excluded.payload,expires=excluded.expires'
        ).run(
          this.model,
          id,
          JSON.stringify(payload),
          Date.now() + (expiresIn ?? 86400) * 1000
        );
      }
      consume(id) {
        const result = db
          .prepare(
            "UPDATE models SET payload=json_set(payload,'$.consumed',?) WHERE model=? AND id=? AND json_extract(payload,'$.consumed') IS NULL AND expires>?"
          )
          .run(Math.floor(Date.now() / 1000), this.model, id, Date.now());
        if (result.changes !== 1) throw new InvalidGrant('Already consumed');
      }
      destroy(id) {
        db.prepare('DELETE FROM models WHERE model=? AND id=?').run(
          this.model,
          id
        );
      }
      revokeByGrantId(id) {
        db.prepare(
          "DELETE FROM models WHERE json_extract(payload,'$.grantId')=?"
        ).run(id);
      }
    },
  };
}
