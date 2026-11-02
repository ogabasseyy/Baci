import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'primary-wallet-paid-interest-inbox-capture.integration.sql'
);

it.runIf(process.env.BACI_PRIMARY_WALLET_SQL_TESTS === 'true')(
  'keeps production paid-interest exclusive while permitting pre-transition legacy reversals in isolated PostgreSQL',
  async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'primary-interest-'));
    const data = path.join(directory, 'data');
    const options = { encoding: 'utf8' as const, timeout: 60000 };
    let started = false;
    const subprocesses: Array<{
      child: ReturnType<typeof spawn>;
      closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
      exited: boolean;
      spawnError: string;
    }> = [];
    try {
      execFileSync(
        'initdb',
        ['-D', data, '-U', 'postgres', '-A', 'trust', '--no-locale'],
        options
      );
      execFileSync(
        'pg_ctl',
        [
          '-D',
          data,
          '-l',
          path.join(directory, 'postgres.log'),
          '-o',
          `-k ${directory} -p 56515 -c listen_addresses=''`,
          '-w',
          'start',
        ],
        options
      );
      started = true;
      const psqlArgs = [
        '-X',
        '-q',
        '-A',
        '-t',
        '-v',
        'ON_ERROR_STOP=1',
        '-h',
        directory,
        '-p',
        '56515',
        '-U',
        'postgres',
        '-d',
        'postgres',
      ];
      const result = execFileSync(
        'psql',
        [...psqlArgs, '-f', fixture],
        options
      );
      expect(result).toContain(
        'PRIMARY production paid-interest, capacity, earnings and notification regressions passed'
      );

      const merchantId = '00000000-0000-4000-8000-000000000001';
      const userId = '00000000-0000-4000-8000-000000000003';
      const rpc = 'public.get_customer_savings_interest_snapshot';
      const baseline = JSON.parse(
        execFileSync(
          'psql',
          [
            ...psqlArgs,
            '-c',
            `SET request.jwt.claim.sub='${userId}'; SELECT ${rpc}('${merchantId}')::text;`,
          ],
          options
        ).trim()
      ) as { credited_interest_kobo: number; interest_history: unknown[] };

      const barrierKey = '741852963';
      const readerAppName = 'paid-interest-snapshot-barrier-reader';
      const startPsql = () => {
        const child = spawn('psql', psqlArgs, {
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        const process = {
          child,
          exited: false,
          spawnError: '',
          closed: new Promise<{
            code: number | null;
            signal: NodeJS.Signals | null;
          }>((resolve) => {
            child.once('close', (code, signal) => {
              process.exited = true;
              resolve({ code, signal });
            });
          }),
        };
        child.on('error', (error: Error) => {
          process.spawnError = error.message;
        });
        subprocesses.push(process);
        return process;
      };
      const writerProcess = startPsql();
      const writer = writerProcess.child;
      let writerOutput = '';
      let writerError = '';
      writer.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        writerOutput += chunk;
      });
      writer.stderr.setEncoding('utf8').on('data', (chunk: string) => {
        writerError += chunk;
      });
      const waitForOutput = async (
        output: () => string,
        marker: string,
        closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }>,
        label: string
      ) => {
        const deadline = Date.now() + 10000;
        while (!output().includes(marker)) {
          if (Date.now() >= deadline)
            throw new Error(`Timed out waiting for ${label}: ${output()}`);
          await Promise.race([
            new Promise((resolve) => setTimeout(resolve, 20)),
            closed.then(({ code, signal }) => {
              if (!output().includes(marker))
                throw new Error(
                  `Process ended before ${label} (code=${code}, signal=${signal}): ${output()}`
                );
            }),
          ]);
        }
      };

      writer.stdin.write(
        `BEGIN; SELECT pg_advisory_xact_lock(${barrierKey}); SELECT 'snapshot-barrier-writer-ready';\n`
      );
      await waitForOutput(
        () => writerOutput,
        'snapshot-barrier-writer-ready',
        writerProcess.closed,
        'writer lock'
      );

      const snapshotProcess = startPsql();
      const snapshotRead = snapshotProcess.child;
      let snapshotOutput = '';
      let snapshotError = '';
      snapshotRead.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        snapshotOutput += chunk;
      });
      snapshotRead.stderr.setEncoding('utf8').on('data', (chunk: string) => {
        snapshotError += chunk;
      });
      snapshotRead.stdin.end(`
        SET application_name='${readerAppName}';
        SET request.jwt.claim.sub='${userId}';
        CREATE FUNCTION pg_temp.await_snapshot_barrier() RETURNS boolean
          LANGUAGE plpgsql VOLATILE AS $$
          BEGIN
            PERFORM pg_advisory_lock_shared(${barrierKey});
            PERFORM pg_advisory_unlock_shared(${barrierKey});
            RETURN true;
          END $$;
        WITH gate AS MATERIALIZED (
          SELECT pg_temp.await_snapshot_barrier() AS ready
        )
        SELECT ${rpc}('${merchantId}')::text FROM gate WHERE ready;
      `);

      const lockDeadline = Date.now() + 10000;
      let readerWaitingOnBarrier = false;
      while (!readerWaitingOnBarrier && Date.now() < lockDeadline) {
        readerWaitingOnBarrier =
          execFileSync(
            'psql',
            [
              ...psqlArgs,
              '-c',
              `SELECT EXISTS (
                 SELECT 1 FROM pg_stat_activity
                 WHERE application_name='${readerAppName}'
                   AND wait_event_type='Lock' AND wait_event='advisory'
               );`,
            ],
            options
          ).trim() === 't';
        if (!readerWaitingOnBarrier)
          await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(readerWaitingOnBarrier).toBe(true);

      writer.stdin.write(`
        INSERT INTO piggyvest_primary.paid_interest_reversals
          (integration_id,provider_reversal_id,payout_id,amount_kobo,provider_evidence_sha256,evidence_reference)
        VALUES ('00000000-0000-4000-8000-000000000005','snapshot-race-reversal','payout-48',1,
          repeat('e',64),'isolated-concurrent-snapshot-regression');
        COMMIT;
        SELECT 'snapshot-barrier-writer-committed';
      `);
      await waitForOutput(
        () => writerOutput,
        'snapshot-barrier-writer-committed',
        writerProcess.closed,
        'writer commit'
      );
      writer.stdin.end('\\q\n');
      const writerExit = await writerProcess.closed;
      expect(writerExit.code, writerError || writerProcess.spawnError).toBe(0);
      const snapshotExit = await snapshotProcess.closed;
      expect(
        snapshotExit.code,
        snapshotError || snapshotProcess.spawnError
      ).toBe(0);
      const duringRace = JSON.parse(snapshotOutput.trim()) as typeof baseline;
      expect(duringRace).toEqual(baseline);

      const afterRace = JSON.parse(
        execFileSync(
          'psql',
          [
            ...psqlArgs,
            '-c',
            `SET request.jwt.claim.sub='${userId}'; SELECT ${rpc}('${merchantId}')::text;`,
          ],
          options
        ).trim()
      ) as typeof baseline;
      expect(afterRace.credited_interest_kobo).toBe(
        baseline.credited_interest_kobo - 1
      );
      expect(afterRace.interest_history).toContainEqual(
        expect.objectContaining({
          id: 'primary-reversal:00000000-0000-4000-8000-000000000005:snapshot-race-reversal',
          amount: -0.01,
        })
      );
    } finally {
      try {
        for (const process of subprocesses) {
          if (!process.exited) process.child.kill('SIGTERM');
        }
        await Promise.all(
          subprocesses.map(async (process) => {
            if (process.exited) return;
            await Promise.race([
              process.closed,
              new Promise((resolve) => setTimeout(resolve, 1000)),
            ]);
            if (!process.exited) process.child.kill('SIGKILL');
            await process.closed;
          })
        );
      } finally {
        try {
          if (started)
            execFileSync(
              'pg_ctl',
              ['-D', data, '-m', 'immediate', '-w', 'stop'],
              options
            );
        } finally {
          rmSync(directory, { recursive: true, force: true });
        }
      }
    }
  },
  120000
);
