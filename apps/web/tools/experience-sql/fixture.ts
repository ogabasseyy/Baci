import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  asActor as baseAsActor,
  draftFixture,
} from '../builder-auth/draft-fixture.ts';
export async function experienceSqlFixture(
  options: { asyncEdits?: boolean } = {}
) {
  const f = await draftFixture({ local: true, asyncEdits: options.asyncEdits });
  await f.pool.query(
    'CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id),not_after timestamptz)'
  );
  return f;
}
const sessions = new WeakMap<PoolClient, Map<string, string>>();
export async function asActor<T>(
  client: PoolClient,
  actor: string,
  run: () => Promise<T>
) {
  let actors = sessions.get(client);
  if (!actors) {
    actors = new Map();
    sessions.set(client, actors);
  }
  let sid = actors.get(actor);
  if (!sid) {
    sid = randomUUID();
    await client.query('INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)', [
      sid,
      actor,
    ]);
    actors.set(actor, sid);
  }
  const sessionId = sid;
  return baseAsActor(client, actor, async () => {
    await client.query("SELECT set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({
        sub: actor,
        role: 'authenticated',
        session_id: sessionId,
      }),
    ]);
    return run();
  }) as Promise<T>;
}
