import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { lifecycleDataClient } from './data-client.test-support';
import {
  buildRollbackArtifact,
  rollbackFolder,
} from './rollback-build.test-support';
import { hash, lifecycleFixture } from './sql.test-support';

it('retains two real offline builds and proves compatible whole-site rollback in a fully rolled-back normal-role transaction', async () => {
  const f = await lifecycleFixture();
  const data = await lifecycleDataClient(f);
  try {
    const previous = await buildRollbackArtifact(f, data.client, 'previous', 0);
    const current = await buildRollbackArtifact(
      f,
      data.client,
      'current',
      1,
      previous.sourceDigest
    );
    expect(current.digest).not.toBe(previous.digest);
    expect(previous.receipt.manifest.runtime).toBe(
      current.receipt.manifest.runtime
    );
    expect(previous.receipt.toolchain.digest).toBe(
      current.receipt.toolchain.digest
    );
    for (const built of [previous, current]) {
      expect(built.receipt.independentProofs).toHaveLength(6);
      expect(built.receipt.captures).toHaveLength(4);
    }
    const sourceBefore = (
      await data.client
        .from('experience_source_heads')
        .select('artifact_id,version')
        .eq('merchant_id', f.merchantId)
        .single()
    ).data;
    const publicBefore = (
      await f.pool.query(
        'SELECT count(*)::int n FROM experience_published_heads'
      )
    ).rows[0].n;
    expect(publicBefore).toBe(0);
    const sid = randomUUID();
    await f.pool.query('INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)', [
      sid,
      f.actor,
    ]);
    const call = async (name: string, args: unknown[]) => {
      await f.c.query('SET LOCAL ROLE authenticated');
      return (
        await f.c.query(
          `SELECT public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`,
          args
        )
      ).rows[0].result;
    };
    const proof = async (
      intent: { approvalId: string; effectDigest: string },
      kind: 'draft' | 'lifecycle',
      marker: string,
      receiptId?: string
    ) => {
      await f.c.query('SET LOCAL ROLE baci_experience_verifier');
      if (kind === 'draft')
        await f.c.query(
          "INSERT INTO experience_authorization.approval_checks(intent_id,effect_digest,evidence_digest,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '4 minutes')",
          [intent.approvalId, intent.effectDigest, marker]
        );
      else
        await f.c.query(
          "INSERT INTO experience_authorization.lifecycle_checks(intent_id,receipt_id,kind,effect_digest,marker_digest,expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '4 minutes')",
          [
            intent.approvalId,
            receiptId ?? null,
            receiptId ? 'public' : 'render',
            intent.effectDigest,
            marker,
          ]
        );
    };
    let outcome: Record<string, unknown> | undefined;
    await f.c.query('BEGIN');
    try {
      await f.c.query("SELECT set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({
          sub: f.actor,
          role: 'authenticated',
          session_id: sid,
        }),
      ]);
      // These are invisible synthetic trial effects. The entire transaction is always rolled back.
      let sourceVersion = 2;
      let base = current.sourceDigest;
      let draftVersion = 0;
      for (const build of [previous, current]) {
        await call('experience_apply_source', [
          f.merchantId,
          null,
          null,
          build.artifact,
          base,
          sourceVersion,
          randomUUID(),
          build.sourceDigest,
        ]);
        sourceVersion++;
        base = build.sourceDigest;
        const draft = await call('experience_request_draft_apply', [
          f.merchantId,
          null,
          null,
          build.id,
          build.evidence,
          draftVersion,
          randomUUID(),
        ]);
        await proof(draft, 'draft', build.marker);
        await call('experience_confirm_draft_apply', [draft.approvalId]);
        draftVersion++;
        const intent = await call('experience_request_lifecycle', [
          f.merchantId,
          null,
          null,
          'publish',
          {
            buildId: build.id,
            expectedDraftVersion: draftVersion,
            expectedPublishedVersion: draftVersion - 1,
          },
          randomUUID(),
        ]);
        await proof(intent, 'lifecycle', build.marker);
        const receipt = await call('experience_confirm_publication', [
          intent.approvalId,
        ]);
        await proof(intent, 'lifecycle', build.marker, receipt.receiptId);
        expect(
          (await call('experience_load_lifecycle', [intent.approvalId])).status
        ).toBe('live');
      }
      const intent = await call('experience_request_lifecycle', [
        f.merchantId,
        null,
        null,
        'rollback',
        {
          buildId: previous.id,
          expectedDraftVersion: 2,
          expectedPublishedVersion: 2,
        },
        randomUUID(),
      ]);
      await proof(intent, 'lifecycle', previous.marker);
      const receipt = await call('experience_confirm_publication', [
        intent.approvalId,
      ]);
      expect(receipt.publishedVersion).toBe(3);
      expect(
        await call('experience_confirm_publication', [intent.approvalId])
      ).toEqual(receipt);
      await proof(intent, 'lifecycle', previous.marker, receipt.receiptId);
      expect(
        (await call('experience_load_lifecycle', [intent.approvalId])).status
      ).toBe('live');
      await f.c.query('SET LOCAL ROLE anon');
      const publicView = (
        await f.c.query(
          "SELECT experience_public_manifest('approval-fixture') value"
        )
      ).rows[0].value;
      expect(publicView.buildDigest).toBe(previous.digest);
      expect(publicView.routes).toHaveLength(4);
      expect(publicView).not.toHaveProperty('files');
      outcome = {
        trialPublishedVersion: 3,
        trialRollbackBuild: previous.digest,
        allRoutesRestored: publicView.routes,
        responseLossReconciled: true,
        fixturePublicMarkerSimulation: true,
        trialReceiptState: 'live',
      };
    } finally {
      await f.c.query('ROLLBACK');
    }
    expect(
      (
        await f.pool.query(
          'SELECT count(*)::int n FROM experience_published_heads'
        )
      ).rows[0].n
    ).toBe(publicBefore);
    expect(
      (
        await data.client
          .from('experience_source_heads')
          .select('artifact_id,version')
          .eq('merchant_id', f.merchantId)
          .single()
      ).data
    ).toEqual(sourceBefore);
    expect(
      (
        await f.pool.query(
          'SELECT count(*)::int n FROM experience_authorization.lifecycle_receipts'
        )
      ).rows[0].n
    ).toBe(0);
    writeFileSync(
      new URL('rollback-receipt.json', rollbackFolder),
      `${JSON.stringify(
        {
          schema: 'baci.local.rollback-evidence.v1',
          normalAuthRls: true,
          syntheticOnly: true,
          localOnly: true,
          toolchain: previous.receipt.toolchain.digest,
          previous: previous.digest,
          current: current.digest,
          compatibleRuntime: previous.receipt.manifest.runtime,
          compatibleSdk: previous.receipt.manifest.sdkVersion,
          sourceUnchangedAfterDryRun: true,
          publicHeadsBefore: publicBefore,
          publicHeadsAfter: 0,
          transactionRolledBack: true,
          committedPublicationEffects: 0,
          orderOperations: 0,
          paymentOperations: 0,
          aiCalls: 0,
          markerDigest: hash(JSON.stringify(outcome)),
          trial: outcome,
          releaseQualified: false,
        },
        null,
        2
      )}\n`
    );
  } finally {
    await data.close();
    await f.close();
  }
}, 300000);
