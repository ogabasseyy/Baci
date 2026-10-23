/** Local normal-role SQL journey. OAuth/PostgREST/ChatGPT host qualification is separate. */
import { randomUUID } from 'node:crypto';
import type { BuilderContext } from '../../src/lib/builder-connector/types';
import { applyStorefrontOperation } from '../../src/lib/website-builder/apply-edit';
import { confirmStorefrontPublication } from '../../src/lib/website-builder/commit-publication';
import { previewStorefront } from '../../src/lib/website-builder/preview';
import { requestStorefrontPublication } from '../../src/lib/website-builder/publish-intent';
import { queueStorefrontEdit } from '../../src/lib/website-builder/queue-edit';
import { getStorefrontOperation } from '../../src/lib/website-builder/read-operation';
import { runStorefrontEdit } from '../../src/lib/website-builder/run-edit';
import { builderEditLeaseSchema } from '../../src/schemas/builder-edit-lease';
import type { PortableHome } from '../../src/schemas/portable-storefront';
import { publicationRlsClient } from '../../tools/builder-auth/publication-rls-client';
import { publicationFixture } from '../../tools/builder-auth/publication-test-support';
export async function createLifecycleHarness() {
  const f = await publicationFixture();
  const client = publicationRlsClient(f.actor, f.owner);
  const ctx: BuilderContext = {
    merchantId: f.merchantId,
    supabase: client as BuilderContext['supabase'],
    identity: {
      actorUserId: f.actor,
      connectionId: f.connection,
      grantVersion: 1,
      scopes: new Set([
        'storefront.read',
        'storefront.write',
        'storefront.publish',
      ]),
      allowedMerchantIds: [f.merchantId],
      allowCreateStore: false,
    },
  };
  const publicState = async () =>
    (
      await f.pool.query(
        "SELECT published_config,is_published FROM page_configs WHERE merchant_id=$1 AND page_slug='home'",
        [f.merchantId]
      )
    ).rows[0];
  const call = (name: string, args: unknown[]) =>
    f.owner((c) => f.run(c, name, args));
  const journey = async (existing: boolean) => {
    if (existing)
      await f.pool.query(
        "UPDATE page_configs SET published_config=jsonb_build_object('legacy','unchanged'),is_published=true WHERE merchant_id=$1",
        [f.merchantId]
      );
    const before = await publicState();
    const version = await f.version();
    const queued = await queueStorefrontEdit(ctx, {
      storefrontId: f.merchantId,
      expectedVersion: version,
      idempotencyKey: randomUUID(),
      pageSlug: 'home',
      instructions: 'Change hero heading to Approved lifecycle title',
    });
    if (queued.status !== 'pending') throw Error('Expected queued edit');
    await getStorefrontOperation(ctx, queued.operationId);
    const lease = builderEditLeaseSchema.parse(
      await call('builder_claim_edit', [
        f.connection,
        1,
        f.merchantId,
        queued.operationId,
      ])
    );
    const ready = await runStorefrontEdit(ctx, lease, {
      rateLimit: () => ({ allowed: true }),
      generate: async () => ({
        status: 'proposed',
        summary: 'Changed homepage heading',
        operations: [
          {
            kind: 'update_component',
            componentId: 'hero',
            patch: { componentType: 'Hero', title: 'Approved lifecycle title' },
          },
        ],
      }),
    });
    const applied = await applyStorefrontOperation(ctx, {
      storefrontId: f.merchantId,
      operationId: queued.operationId,
      expectedVersion: version,
      idempotencyKey: randomUUID(),
    });
    if (applied.status !== 'draft') throw Error('Expected applied draft');
    const preview = await previewStorefront(ctx, {
      storefrontId: f.merchantId,
      expectedVersion: applied.version,
      pageSlug: 'home',
    });
    if ('status' in preview) throw Error('Expected exact preview');
    const requested = await requestStorefrontPublication(ctx, {
      storefrontId: f.merchantId,
      expectedVersion: applied.version,
      idempotencyKey: randomUUID(),
    });
    if (requested.status !== 'approval_required')
      throw Error('Expected owner approval');
    const unchanged =
      JSON.stringify(before) === JSON.stringify(await publicState());
    const committed = await confirmStorefrontPublication(
      client,
      requested.intentId,
      { certifyRender: () => f.proof(requested.intentId) }
    );
    const state = await publicState();
    const heroTitle = (config: PortableHome) => {
      const hero = config.content.find((block) => block.type === 'Hero');
      return hero?.type === 'Hero' ? hero.props.title : undefined;
    };
    return {
      prepublicationUnchanged: unchanged,
      queued: queued.status,
      ready: ready.status,
      confirmed: committed.status,
      privateTitle: heroTitle(preview.projection.config),
      publishedTitle: heroTitle(state.published_config),
      receipt: committed,
      receiptCount: (
        await f.pool.query(
          'SELECT count(*)::int n FROM builder_authorization.publication_receipts'
        )
      ).rows[0].n,
    };
  };
  return { ...f, ctx, client, call, publicState, journey };
}
