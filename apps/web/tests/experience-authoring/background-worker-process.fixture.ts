import { request } from 'node:http';
import { createInterface } from 'node:readline';
import { createClient } from '@supabase/supabase-js';
import { createBackgroundBuildWorker } from '../../src/lib/experience/background-build-worker';

async function main() {
  const line = await new Promise<string>((resolve) =>
    createInterface({ input: process.stdin }).once('line', resolve)
  );
  const config = JSON.parse(line) as {
    socket: string;
    token: string;
    actor: string;
    merchant: string;
    connection: string;
    job: string;
    mode: 'crash' | 'recover';
  };
  if (
    !config.socket.startsWith('/var/folders/') ||
    !['crash', 'recover'].includes(config.mode)
  )
    throw Error('INVALID_LOCAL_FIXTURE');
  const fetchImpl: typeof fetch = async (input, init) =>
    new Promise((resolve, reject) => {
      const url = new URL(
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url
      );
      const req = request(
        {
          socketPath: config.socket,
          path: url.pathname.replace(/^\/rest\/v1/, '') + url.search,
          method: init?.method ?? 'GET',
          headers: Object.fromEntries(new Headers(init?.headers)),
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (part: Buffer) => chunks.push(part));
          res.on('end', () => {
            const headers = new Headers();
            for (const [key, value] of Object.entries(res.headers))
              if (value !== undefined)
                headers.set(
                  key,
                  Array.isArray(value) ? value.join(', ') : value
                );
            const status = res.statusCode ?? 502;
            resolve(
              new Response(
                [204, 205, 304].includes(status)
                  ? null
                  : new Uint8Array(Buffer.concat(chunks)),
                { status, headers }
              )
            );
          });
        }
      );
      req.on('error', reject);
      req.setTimeout(5000, () => req.destroy(Error('LOCAL_TIMEOUT')));
      req.end(typeof init?.body === 'string' ? init.body : undefined);
    });
  const client = createClient('http://synthetic.local', 'synthetic-anon', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${config.token}` },
      fetch: fetchImpl,
    },
  });
  const row = {
    connectionId: config.connection,
    actorUserId: config.actor,
    grantVersion: 1,
    status: 'active',
    revokedAt: null,
    expiresAt: new Date(Date.now() + 600000).toISOString(),
    scopes: ['storefront.read', 'storefront.write'],
    allowedMerchantIds: [config.merchant],
    allowCreateStore: false,
  };
  let tick = () => {
    /* Installed by the worker scheduler. */
  };
  const worker = createBackgroundBuildWorker({
    listConnections: async () => [config.connection],
    readConnection: async () => row,
    resolveLinkedAccessToken: async () => config.token,
    resolveUser: async () => ({ actorUserId: config.actor, client }),
    resolveUserClient: async () => client,
    finalizeBuild: async (ctx) => {
      const job = await ctx.supabase
        .from('experience_jobs')
        .select('attempt_nonce')
        .eq('id', config.job)
        .eq('merchant_id', config.merchant)
        .single();
      if (job.error || !job.data) throw Error('JOB_MISSING');
      const args = {
        p_merchant: config.merchant,
        p_connection: config.connection,
        p_version: 1,
        p_job: config.job,
        p_attempt: job.data.attempt_nonce,
      };
      const claimed = await ctx.supabase.rpc('experience_claim_build', args);
      if (claimed.error) throw Error('CLAIM_FAILED');
      process.stdout.write('CLAIMED\n');
      if (config.mode === 'crash')
        await new Promise(() => {
          /* Simulate a process stopped mid-build. */
        });
      const failed = await ctx.supabase.rpc('experience_fail_build', args);
      if (failed.error) throw Error('FAIL_FAILED');
      return { buildId: config.job, buildDigest: 'a'.repeat(64) };
    },
    schedule: (callback) => {
      tick = callback;
      return () => {
        /* No timer was installed. */
      };
    },
  });
  tick();
  if (config.mode === 'recover') {
    await worker.close();
    process.stdout.write('DONE\n');
  } else
    setInterval(() => {
      /* Keep the crash fixture alive. */
    }, 10000);
}
void main().catch(() => {
  process.stderr.write('FIXTURE_FAILED\n');
  process.exitCode = 1;
});
