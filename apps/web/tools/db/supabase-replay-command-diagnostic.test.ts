import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { replayCommandRuntime } from './run-replay-command';

const temporaryRoots: string[] = [];

async function rejectedError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error('Expected promise to reject');
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true }))
  );
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'baci-replay-diagnostic-'));
  temporaryRoots.push(root);
  return root;
}

describe('replay command diagnostics', () => {
  it('reports a safe permission category without copying PostgreSQL error text', async () => {
    const root = await temporaryRoot();
    const psql = path.join(root, 'psql');
    await writeFile(
      psql,
      "#!/bin/sh\nprintf 'psql:/owned/replay/secret.sql:42: ERROR:  42501: permission denied for table repair_devices\\nidentity@example.test postgresql://user:password@localhost/db\\n' >&2\nexit 1\n",
      { mode: 0o700 }
    );
    const runCommand = replayCommandRuntime.create(root);

    const failure = await rejectedError(runCommand(psql, []));
    expect(failure).toMatchObject({
      message:
        'psql failed: non-zero-exit (line=42,sqlstate=42501,permission=relation_access_denied)',
    });
    expect(failure.message).not.toMatch(
      /repair_devices|secret\.sql|identity@example|password|permission denied for table/
    );
  });

  it('reports only the first numeric pgTAP failure index from bounded stdout', async () => {
    const root = await temporaryRoot();
    const psql = path.join(root, 'psql');
    await writeFile(
      psql,
      "#!/bin/sh\nprintf 'not ok 34 - secret fixture description\nnot ok 35 - another secret\n'\nprintf 'psql:/owned/replay/secret.sql:110: ERROR:  P0001: fixture content secret\n' >&2\nexit 1\n",
      { mode: 0o700 }
    );
    const runCommand = replayCommandRuntime.create(root);
    const failure = await rejectedError(runCommand(psql, []));

    expect(failure.message).toBe(
      'psql failed: non-zero-exit (line=110,sqlstate=P0001,tap=34)'
    );
    expect(failure.message).not.toMatch(/fixture|description|secret|not ok/);
  });

  it.each([
    ['must be owner of function save_x_ads_settings', 'owner_required'],
    ['permission denied for schema private', 'schema_access_denied'],
    [
      'permission denied for sequence private.sequence_name',
      'sequence_access_denied',
    ],
    [
      'permission denied for table private.secret_table',
      'relation_access_denied',
    ],
    ['permission denied', 'permission_denied'],
  ])('classifies PostgreSQL 42501 category without object data', async (message, category) => {
    const root = await temporaryRoot();
    const psql = path.join(root, 'psql');
    await writeFile(
      psql,
      `#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(`psql:/owned/replay/secret.sql:20: ERROR:  42501: ${message}\npassword=private-value`)} >&2\nexit 1\n`,
      { mode: 0o700 }
    );
    const runCommand = replayCommandRuntime.create(root);
    const failure = await rejectedError(runCommand(psql, []));

    expect(failure).toMatchObject({
      message: `psql failed: non-zero-exit (line=20,sqlstate=42501,permission=${category})`,
    });
    expect(failure.message).not.toMatch(
      /secret\.sql|private|password|private-value/
    );
  });

  it('does not classify arbitrary 42501 details or expose them', async () => {
    const root = await temporaryRoot();
    const psql = path.join(root, 'psql');
    await writeFile(
      psql,
      "#!/bin/sh\nprintf 'psql:/owned/replay/secret.sql:20: ERROR:  42501: private provider secret=never-show-this\\n' >&2\nexit 1\n",
      { mode: 0o700 }
    );
    const runCommand = replayCommandRuntime.create(root);
    const failure = await rejectedError(runCommand(psql, []));

    expect(failure).toMatchObject({
      message: 'psql failed: non-zero-exit (line=20,sqlstate=42501)',
    });
    expect(failure.message).not.toContain('never-show-this');
  });

  it.each([
    ['failed to connect to postgres: connection refused', 'connection-refused'],
    ['failed to pull image from private registry', 'image-pull'],
    ['failed to create docker container', 'container-create'],
    ['bind: address already in use', 'port-conflict'],
    ['container is unhealthy', 'container-health'],
    [
      'client version is too old. Minimum supported API version is 1.44',
      'docker-api',
    ],
    ['no space left on device', 'disk-full'],
    ['ERROR: permission denied (SQLSTATE 42501)', 'postgres-42501'],
  ])('classifies Supabase failures without copying private output: %s', async (message, diagnostic) => {
    const root = await temporaryRoot();
    const supabase = path.join(root, 'supabase');
    await writeFile(
      supabase,
      `#!${process.execPath}\nprocess.stderr.write(${JSON.stringify(`${message}\nhttps://user:private-password@db.example token=private-value`)});process.exit(1);\n`,
      { mode: 0o700 }
    );
    const runCommand = replayCommandRuntime.create(root);
    await expect(runCommand(supabase, ['db', 'start'])).rejects.toMatchObject({
      message: `supabase failed: non-zero-exit (diagnostic=${diagnostic})`,
    });
  });

  it('reports bounded diagnostics from a versioned psql executable', async () => {
    const root = await temporaryRoot();
    const psql = path.join(root, 'psql-18.3');
    await writeFile(
      psql,
      "#!/bin/sh\nprintf 'psql-18.3:/owned/replay/secret.sql:17: ERROR:  23505: duplicate key\\nprivate detail\\n' >&2\nexit 1\n",
      { mode: 0o700 }
    );
    const runCommand = replayCommandRuntime.create(root);

    await expect(runCommand(psql, [])).rejects.toThrow(
      /^psql-18\.3 failed: non-zero-exit \(line=17,sqlstate=23505\)$/
    );
  });
});
