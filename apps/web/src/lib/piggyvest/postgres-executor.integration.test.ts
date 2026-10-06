import { createHmac } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { piggyvestPostgresConfigurationSchema } from '@/schemas/piggyvest-postgres-configuration';
import { createPiggyvestPostgresExecutor } from './postgres-executor';
import { createPiggyvestPostgresInbox } from './postgres-inbox';
import { quarantinePiggyvestInboxBatch } from './quarantine-inbox';
import { createPiggyvestStagingRuntime } from './staging-runtime';

vi.mock('server-only', () => ({}));

describe.skipIf(process.env.PIGGYVEST_RUN_LOCAL_POSTGRES !== '1')(
  'restricted PostgreSQL runtime',
  () => {
    const integrationId = '44444444-4444-4444-8444-444444444444';
    let admin: Client;
    let configuration: ReturnType<
      typeof piggyvestPostgresConfigurationSchema.parse
    >;
    let inbox: ReturnType<typeof createPiggyvestPostgresInbox>;
    const rawPayload = Buffer.from('{"synthetic":true}');

    beforeAll(async () => {
      configuration = piggyvestPostgresConfigurationSchema.parse({
        environment: 'staging',
        transport: 'local_test',
        socketDirectory: process.env.PIGGYVEST_LOCAL_TEST_SOCKET,
        database: 'piggyvest_local',
        password: 'synthetic-local-only',
        role: 'piggyvest_staging_intake',
        port: 55443,
      });
      if (configuration.transport !== 'local_test')
        throw new Error('Local fixture required');
      admin = new Client({
        host: configuration.socketDirectory,
        port: configuration.port,
        database: configuration.database,
        user: 'harness_admin',
        password: configuration.password,
        ssl: false,
        options: '-c search_path=pg_catalog -c statement_timeout=2500',
        connectionTimeoutMillis: 1000,
        query_timeout: 3000,
      });
      vi.stubGlobal(
        'fetch',
        vi.fn(() => {
          throw new Error('External HTTP prohibited');
        })
      );
      await admin.connect();
      inbox = createPiggyvestPostgresInbox({
        integrationId,
        execute: createPiggyvestPostgresExecutor(configuration),
      });
    });

    afterAll(async () => {
      try {
        expect(globalThis.fetch).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
        await admin?.end();
      }
    });

    it('connects raw authenticated request intake to durable storage and quarantine', async () => {
      const secret = 'synthetic-runtime-secret';
      const runtime = createPiggyvestStagingRuntime({
        intake: {
          environment: 'staging',
          integrationId,
          secret,
          expectedProjectId: 'synthetic-project',
          actualProjectId: 'synthetic-project',
          rawByteSignatureVerified: true,
          durableAcknowledgementApproved: true,
        },
        intakeDatabase: configuration,
        workerDatabase: { ...configuration, role: 'piggyvest_staging_worker' },
      });
      const body = JSON.stringify({
        eventId: 'synthetic-signed-runtime',
        customer_id: 'synthetic-customer',
        eventType: 'synthetic.unsupported',
        eventCategory: 'synthetic',
        eventData: {},
      });
      const signature = createHmac('sha512', secret).update(body).digest('hex');
      const request = (signed: string) =>
        new Request('https://synthetic.example.test/api/webhooks/piggyvest', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-pvb-signature': signed,
          },
          body,
        });
      expect(await runtime.accept(request('invalid'))).toBe(
        'invalid_signature'
      );
      expect(await runtime.accept(request(signature))).toBe('accepted');
      expect(await runtime.accept(request(signature))).toBe('duplicate');
      expect(await runtime.quarantine()).toMatchObject({
        status: 'complete',
        claimed: 1,
        quarantined: 1,
        failed: 0,
      });
    });

    it('commits before acknowledging and deduplicates concurrent deliveries', async () => {
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          inbox.enqueue({
            integrationId,
            eventId: 'synthetic-concurrent',
            rawPayload,
          })
        )
      );
      expect(results.filter((result) => result === 'accepted')).toHaveLength(1);
      expect(results.filter((result) => result === 'duplicate')).toHaveLength(
        3
      );
      const stored = await admin.query(
        'SELECT count(*)::integer AS count FROM piggyvest_staging.inbox WHERE provider_event_id = $1',
        ['synthetic-concurrent']
      );
      expect(stored.rows).toEqual([{ count: 1 }]);
    });

    it('quarantines unsupported events through the worker role without financial effects', async () => {
      const result = await quarantinePiggyvestInboxBatch({
        configuration: {
          environment: 'staging',
          integrationId,
          batchSize: 10,
          leaseSeconds: 60,
        },
        execute: createPiggyvestPostgresExecutor({
          ...configuration,
          role: 'piggyvest_staging_worker',
        }),
      });
      expect(result).toMatchObject({
        status: 'complete',
        claimed: 1,
        quarantined: 1,
        failed: 0,
      });
    });

    it('does not acknowledge a deferred COMMIT failure and leaves no inbox row', async () => {
      await expect(
        inbox.enqueue({
          integrationId,
          eventId: 'synthetic-commit-failure',
          rawPayload,
        })
      ).rejects.toThrow('PiggyVest inbox unavailable');
      const stored = await admin.query(
        'SELECT count(*)::integer AS count FROM piggyvest_staging.inbox WHERE provider_event_id = $1',
        ['synthetic-commit-failure']
      );
      expect(stored.rows).toEqual([{ count: 0 }]);
    });

    it('enforces database permissions independently of the SQL allowlist', async () => {
      if (configuration.transport !== 'local_test')
        throw new Error('Local fixture required');
      const restricted = new Client({
        host: configuration.socketDirectory,
        port: configuration.port,
        database: configuration.database,
        user: configuration.role,
        password: configuration.password,
        ssl: false,
        options: '-c search_path=pg_catalog',
        connectionTimeoutMillis: 1000,
        query_timeout: 2000,
      });
      try {
        await restricted.connect();
        await expect(
          restricted.query(
            'SELECT id FROM piggyvest_staging.provisioning_intents'
          )
        ).rejects.toMatchObject({ code: '42501' });
        await expect(
          restricted.query(
            'SELECT piggyvest_staging.prepare_provisioning_intent($1::uuid, $2::uuid, $3::uuid, NULL, $4::text, $5::bytea)',
            [
              integrationId,
              '11111111-1111-4111-8111-111111111111',
              '22222222-2222-4222-8222-222222222222',
              'create_customer',
              Buffer.alloc(32),
            ]
          )
        ).rejects.toMatchObject({ code: '42501' });
      } finally {
        await restricted.end();
      }
    });

    it('bounds database lock waits without acknowledging an uncommitted write', async () => {
      await admin.query('BEGIN');
      try {
        await admin.query(
          'LOCK piggyvest_staging.inbox IN ACCESS EXCLUSIVE MODE'
        );
        await expect(
          inbox.enqueue({
            integrationId,
            eventId: 'synthetic-lock-timeout',
            rawPayload,
          })
        ).rejects.toThrow('PiggyVest inbox unavailable');
      } finally {
        await admin.query('ROLLBACK');
      }
    });
  }
);
