import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import { experienceDataFixture } from './data-fixture.test-support';

vi.mock('server-only', () => ({}));

it('recovers a job after its worker process is killed', async () => {
  const f = await experienceDataFixture({ tokenTtlSeconds: 900 });
  const children: ChildProcessWithoutNullStreams[] = [];
  try {
    const artifact = randomUUID();
    await f.db.pool.query(
      "INSERT INTO experience_artifacts(id,merchant_id,source_digest,manifest) VALUES($1,$2,repeat('a',64),'{}')",
      [artifact, f.merchantId]
    );
    const queued = await f.owner.supabase.rpc('experience_queue_build', {
      p_merchant: f.merchantId,
      p_connection: f.connectionId,
      p_version: 1,
      p_artifact: artifact,
      p_retry: randomUUID(),
    });
    expect(queued.error).toBeNull();
    const job = queued.data as string;
    const start = (mode: 'crash' | 'recover') => {
      const child = spawn(
        process.execPath,
        [
          '--conditions=react-server',
          '--import',
          'tsx',
          fileURLToPath(
            new URL('./background-worker-process.fixture.ts', import.meta.url)
          ),
        ],
        {
          cwd: process.cwd(),
          env: { PATH: process.env.PATH, LANG: 'C.UTF-8', NODE_ENV: 'test' },
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      );
      children.push(child);
      child.stdin.end(
        `${JSON.stringify({ socket: f.apiSocketPath, token: f.owner.accessToken, actor: f.actorId, merchant: f.merchantId, connection: f.connectionId, job, mode })}\n`
      );
      return child;
    };
    const first = start('crash');
    let firstError = '';
    first.stderr.on('data', (chunk) => {
      firstError += String(chunk);
    });
    const [claimed] = await Promise.race([
      once(first.stdout, 'data'),
      once(first, 'exit').then(() => {
        throw Error(`FIRST_PROCESS_EXITED: ${firstError}`);
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(Error('FIRST_PROCESS_TIMEOUT')), 15000)
      ),
    ]);
    expect(String(claimed)).toContain('CLAIMED');
    const old = (
      await f.db.pool.query(
        'SELECT attempt_nonce FROM experience_jobs WHERE id=$1',
        [job]
      )
    ).rows[0].attempt_nonce;
    const firstExit = once(first, 'exit');
    first.kill('SIGKILL');
    await firstExit;
    await f.db.pool.query(
      "UPDATE experience_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [job]
    );
    const second = start('recover');
    let output = '';
    second.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    const [code] = await Promise.race([
      once(second, 'exit'),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(Error('SECOND_PROCESS_TIMEOUT')), 15000)
      ),
    ]);
    expect(code).toBe(0);
    expect(output).toContain('CLAIMED');
    expect(output).toContain('DONE');
    const state = (
      await f.db.pool.query(
        'SELECT status,attempt_nonce,background_recoveries FROM experience_jobs WHERE id=$1',
        [job]
      )
    ).rows[0];
    expect(state).toMatchObject({ status: 'failed', background_recoveries: 1 });
    expect(state.attempt_nonce).not.toBe(old);
  } finally {
    for (const child of children)
      if (child.exitCode === null && child.signalCode === null) {
        const childExit = once(child, 'exit');
        child.kill('SIGKILL');
        await childExit.catch(() => undefined);
      }
    await f.close();
  }
}, 60000);
