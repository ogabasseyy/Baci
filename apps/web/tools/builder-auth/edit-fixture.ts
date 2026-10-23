import { randomUUID } from 'node:crypto';
import { asActor, draftFixture } from './draft-fixture.ts';

export { asActor };
export async function editFixture() {
  const f = await draftFixture({ asyncEdits: true });
  const c = await f.pool.connect();
  try {
    const actor = randomUUID();
    const connection = randomUUID();
    const other = randomUUID();
    await f.pool.query('INSERT INTO auth.users VALUES($1),($2)', [
      actor,
      other,
    ]);
    await f.pool.query(
      "INSERT INTO builder_authorization.connections(id,actor_user_id,provider_grant_id,scopes,allow_create_store,expires_at) VALUES($1::uuid,$2,$1::text,ARRAY['storefront.read','storefront.write'],true,now()+interval '1 hour')",
      [connection, actor]
    );
    const source = {
      root: {
        props: { rendererVersion: 'baci-home-six-v1', title: 'Fixture' },
      },
      content: [
        {
          type: 'Header',
          props: { id: 'header', navigationLinks: [], showLogo: true },
        },
        { type: 'Hero', props: { id: 'hero', title: 'Fixture' } },
        { type: 'Footer', props: { id: 'footer', copyrightText: 'Fixture' } },
      ],
    };
    const created = await asActor(c, actor, () =>
      c.query('SELECT builder_create_draft($1,1,$2,$3,$4) result', [
        connection,
        randomUUID(),
        {
          businessName: 'Fixture Store',
          businessType: 'electronics',
          country: 'NG',
          requestedSlug: 'edit-fixture',
        },
        source,
      ])
    );
    const store = (
      created as {
        rows: { result: { storefrontId: string; version: string } }[];
      }
    ).rows[0].result;
    const merchant = store.storefrontId;
    const version = store.version.slice(6);
    const call = async (name: string, args: unknown[], who = actor) =>
      asActor(c, who, () =>
        c.query(
          `SELECT ${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`,
          args
        )
      ) as Promise<{ rows: { result: Record<string, unknown> }[] }>;
    const queue = (key = randomUUID(), instructions = 'Change title') =>
      call('builder_queue_edit', [
        connection,
        1,
        merchant,
        version,
        key,
        instructions,
      ]);
    const claim = (id: unknown) =>
      call('builder_claim_edit', [connection, 1, merchant, id]);
    const finish = (
      id: unknown,
      lease: unknown,
      outcome = 'ready',
      candidate: unknown = source
    ) =>
      call('builder_finish_edit', [
        connection,
        1,
        merchant,
        id,
        lease,
        outcome,
        candidate,
      ]);
    const close = async () => {
      c.release();
      await f.close();
    };
    return {
      ...f,
      actor,
      other,
      connection,
      merchant,
      version,
      source,
      call,
      queue,
      claim,
      finish,
      close,
    };
  } catch (error) {
    c.release();
    await f.close();
    throw error;
  }
}
