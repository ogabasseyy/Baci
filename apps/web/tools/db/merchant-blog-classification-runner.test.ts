import { spawnSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryRoots: string[] = [];
const runnerPath = path.resolve(
  import.meta.dirname,
  '../../../../supabase/tests/run-merchant-blog-classification.sh'
);

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true }))
  );
});

async function runWithFakeDocker(options: {
  markerAfterLogs: number;
  readyAfterChecks: number;
  args?: string[];
}) {
  const root = await mkdtemp(
    path.join(tmpdir(), 'baci-classification-runner-')
  );
  temporaryRoots.push(root);
  const tracePath = path.join(root, 'trace.log');
  const inputsPath = path.join(root, 'psql-inputs');
  const dockerPath = path.join(root, 'docker');
  const sleepPath = path.join(root, 'sleep');
  await writeFile(tracePath, '');
  await mkdir(inputsPath);

  await writeFile(
    dockerPath,
    String.raw`#!/bin/sh
set -eu
printf 'docker %s\n' "$*" >> "$TRACE_FILE"
case "$1" in
  run) exit 0 ;;
  logs)
    count_file="$TRACE_FILE.logs"
    count=0
    if [ -f "$count_file" ]; then count=$(cat "$count_file"); fi
    count=$((count + 1))
    printf '%s' "$count" > "$count_file"
    if [ "$count" -ge "$MARKER_AFTER_LOGS" ]; then
      printf 'marker-present\n' >> "$TRACE_FILE"
      printf 'PostgreSQL init process complete; ready for start up.\n'
    else
      printf 'marker-absent\n' >> "$TRACE_FILE"
    fi
    ;;
  exec)
    shift
    if [ "$1" = '-i' ]; then shift; fi
    shift
    if [ "$1" = 'pg_isready' ]; then
      count_file="$TRACE_FILE.ready"
      count=0
      if [ -f "$count_file" ]; then count=$(cat "$count_file"); fi
      count=$((count + 1))
      printf '%s' "$count" > "$count_file"
      if [ "$count" -ge "$PG_READY_AFTER_CHECKS" ]; then
        printf 'ready-yes\n' >> "$TRACE_FILE"
        exit 0
      fi
      printf 'ready-no\n' >> "$TRACE_FILE"
      exit 1
    fi
    if [ "$1" = 'psql' ]; then
      count_file="$TRACE_FILE.psql"
      count=0
      if [ -f "$count_file" ]; then count=$(cat "$count_file"); fi
      count=$((count + 1))
      printf '%s' "$count" > "$count_file"
      cat > "$PSQL_INPUTS_DIR/$count.sql"
      printf 'psql\n' >> "$TRACE_FILE"
      exit 0
    fi
    ;;
  rm) printf 'cleanup\n' >> "$TRACE_FILE" ;;
esac
exit 0
`
  );
  await writeFile(sleepPath, '#!/bin/sh\nexit 0\n');
  await Promise.all([chmod(dockerPath, 0o700), chmod(sleepPath, 0o700)]);

  const result = spawnSync('/bin/bash', [runnerPath, ...(options.args ?? [])], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${root}:${process.env.PATH ?? ''}`,
      TRACE_FILE: tracePath,
      PSQL_INPUTS_DIR: inputsPath,
      MARKER_AFTER_LOGS: String(options.markerAfterLogs),
      PG_READY_AFTER_CHECKS: String(options.readyAfterChecks),
    },
  });

  const inputFiles = await readdir(inputsPath);
  const payloads = await Promise.all(
    inputFiles
      .sort(
        (left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10)
      )
      .map((file) => readFile(path.join(inputsPath, file), 'utf8'))
  );

  return { result, trace: await readFile(tracePath, 'utf8'), payloads };
}

describe('merchant blog classification SQL runner readiness', () => {
  it('waits for init completion before accepting an early temporary-server response', async () => {
    const { result, trace } = await runWithFakeDocker({
      markerAfterLogs: 3,
      readyAfterChecks: 1,
    });

    expect(result.status).toBe(0);
    const markerIndex = trace.indexOf('marker-present');
    const finalReadyIndex = trace.indexOf('ready-yes', markerIndex);
    const firstSqlIndex = trace.indexOf('psql');
    expect(markerIndex).toBeGreaterThan(-1);
    expect(finalReadyIndex).toBeGreaterThan(markerIndex);
    expect(firstSqlIndex).toBeGreaterThan(finalReadyIndex);
  });

  it('fails without running SQL when init completed but the final server never becomes ready', async () => {
    const { result, trace } = await runWithFakeDocker({
      markerAfterLogs: 1,
      readyAfterChecks: 999,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('PostgreSQL did not become ready');
    expect(trace).toContain('marker-present');
    expect(trace).toContain('cleanup');
    expect(trace).not.toContain('psql');
  });

  it('fails without running SQL when the temporary server answers but init never completes', async () => {
    const { result, trace } = await runWithFakeDocker({
      markerAfterLogs: 999,
      readyAfterChecks: 1,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('PostgreSQL did not become ready');
    expect(trace).toContain('marker-absent');
    expect(trace).toContain('ready-yes');
    expect(trace).toContain('cleanup');
    expect(trace).not.toContain('psql');
  });

  it.each([
    '--before-guides',
    '--before-snapshot',
    '--before-private-boundary',
  ])('rejects unsupported negative probe %s before creating a container', async (argument) => {
    const { result, trace } = await runWithFakeDocker({
      markerAfterLogs: 1,
      readyAfterChecks: 1,
      args: [argument],
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Unsupported argument');
    expect(trace).toBe('');
  });

  it('keeps the default full replay and schema contract enabled', async () => {
    const { result, payloads } = await runWithFakeDocker({
      markerAfterLogs: 1,
      readyAfterChecks: 1,
    });

    expect(result.status).toBe(0);
    expect(payloads).toContain(
      await readFile(
        path.resolve(
          import.meta.dirname,
          '../../../../supabase/tests/merchant_blog_classification_guides.sql'
        ),
        'utf8'
      )
    );
    expect(payloads).toContain(
      await readFile(
        path.resolve(
          import.meta.dirname,
          '../../../../supabase/tests/merchant_blog_classification_schema_contract.sql'
        ),
        'utf8'
      )
    );
  });
});
