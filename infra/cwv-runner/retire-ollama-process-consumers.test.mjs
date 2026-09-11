import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);

test('keeps compound process consumers while exempting only the reviewed Ollama server', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-ollama-process-consumers-')
  );
  const processes = join(directory, 'processes');
  const approved = '42 1 root /usr/bin/ollama serve';
  const compound =
    '43 1 root /usr/bin/ollama serve & /opt/worker --listen 127.0.0.1:11434';
  try {
    await writeFile(processes, `${approved}\n${compound}\n`);
    const { stdout } = await execFileAsync('sh', [
      '-c',
      'RETIRE_OLLAMA_TEST_BIN=/sbin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; . "$1"; init_temp_root; trap cleanup_temp EXIT; APPROVED_OLLAMA_PID=42; APPROVED_OLLAMA_PROCESS_IDENTITY=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; deps="[]"; consumer_counts="[]"; consumer_evidence="[]"; record_consumers running-processes "$2"; printf "%s\\n%s\\n" "$consumer_counts" "$consumer_evidence"',
      'retire-ollama-process-consumers-test',
      script.pathname,
      processes,
    ]);
    const [counts, evidence] = stdout.trim().split('\n').map(JSON.parse);
    assert.deepEqual(counts, [{ surface: 'running-processes', matchCount: 1 }]);
    assert.deepEqual(evidence, [
      {
        surface: 'running-processes',
        classifiedPathSha256: createHash('sha256')
          .update(compound)
          .digest('hex'),
      },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('classifies an uppercase Ollama marker in a foreign running process', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-ollama-uppercase-process-')
  );
  const processes = join(directory, 'processes');
  const foreign = '43 1 worker /opt/OLLAMA';
  try {
    await writeFile(processes, `${foreign}\n`);
    const { stdout } = await execFileAsync('sh', [
      '-c',
      'RETIRE_OLLAMA_TEST_BIN=/sbin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; . "$1"; init_temp_root; trap cleanup_temp EXIT; deps="[]"; consumer_counts="[]"; consumer_evidence="[]"; record_consumers running-processes "$2"; printf "%s\\n%s\\n" "$consumer_counts" "$consumer_evidence"',
      'retire-ollama-uppercase-process-test',
      script.pathname,
      processes,
    ]);

    const [counts, evidence] = stdout.trim().split('\n').map(JSON.parse);
    assert.deepEqual(counts, [{ surface: 'running-processes', matchCount: 1 }]);
    assert.deepEqual(evidence, [
      {
        surface: 'running-processes',
        classifiedPathSha256: createHash('sha256')
          .update(foreign)
          .digest('hex'),
      },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('uses untruncated ps args so a long compound process remains a consumer', async () => {
  const approved = '42 1 root /usr/bin/ollama serve';
  const compound = `${approved} & /opt/worker --listen 127.0.0.1:11434`;
  const source = await readFile(script, 'utf8');
  assert.match(source, /ps -ww -eo pid,ppid,user,args >"\$processes"/);
  const { stdout } = await execFileAsync(
    'sh',
    [
      '-c',
      'RETIRE_OLLAMA_TEST_BIN=/sbin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; . "$1"; init_temp_root; trap cleanup_temp EXIT; ps() { if [ "$1" = -ww ]; then printf "%s\\n" "$COMPOUND"; else printf "%s\\n" "$APPROVED"; fi; }; records="[]"; deps="[]"; consumer_counts="[]"; consumer_evidence="[]"; record_scan running-processes ps -ww -eo pid,ppid,user,args; printf "%s\\n%s\\n" "$consumer_counts" "$consumer_evidence"',
      'retire-ollama-process-consumers-test',
      script.pathname,
    ],
    { env: { ...process.env, APPROVED: approved, COMPOUND: compound } }
  );
  const [counts, evidence] = stdout.trim().split('\n').map(JSON.parse);
  assert.deepEqual(counts, [{ surface: 'running-processes', matchCount: 1 }]);
  assert.deepEqual(evidence, [
    {
      surface: 'running-processes',
      classifiedPathSha256: createHash('sha256').update(compound).digest('hex'),
    },
  ]);
});
