import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);
const prelude =
  'RETIRE_OLLAMA_TEST_BIN=/usr/bin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; stat() { inode=$(/bin/ls -di "$3" | /usr/bin/awk "{print \\$1}"); printf "1:%s:81a4:10:501:20:644\\n" "$inode"; }; findmnt() { printf "/ fixture apfs ro\\n"; }; ';

async function expectReplacementRace(initial, replacement) {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-consumer-snapshot-race-'))
  );
  const compose = join(directory, 'compose.yaml');
  const next = join(directory, 'next.yaml');
  try {
    await mkdir(directory, { recursive: true });
    await Promise.all([
      writeFile(compose, initial),
      writeFile(next, replacement),
    ]);
    await assert.rejects(
      execFileAsync('sh', [
        '-c',
        `${prelude}. "$1"; SCRIPT_DIR=$(dirname "$1"); COMPOSE_ROOTS="$2"; next=$3; definition=$4; marker=$5; init_temp_root; trap cleanup_temp EXIT; load_consumer_scanners; consumer_matches() { /usr/bin/grep -q -Ei 'ollama|11434' "$1"; status=$?; if [ ! -e "$marker" ]; then : >"$marker"; mv "$next" "$definition"; fi; return "$status"; }; scan_compose_definitions`,
        'retire-ollama-consumer-snapshot-race-test',
        script.pathname,
        directory,
        next,
        compose,
        join(directory, 'mutated'),
      ]),
      (error) => error.code === 2
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('fails closed when a matched Compose definition becomes a non-match before fingerprinting', async () => {
  await expectReplacementRace(
    'services:\n  app:\n    environment:\n      OLLAMA_HOST: http://127.0.0.1:11434\n',
    'services:\n  app:\n    environment:\n      OTHER: 1\n'
  );
});

test('fails closed when a non-matching Compose definition becomes a consumer before fingerprinting', async () => {
  await expectReplacementRace(
    'services:\n  app:\n    environment:\n      OTHER: 1\n',
    'services:\n  app:\n    environment:\n      OLLAMA_HOST: http://127.0.0.1:11434\n'
  );
});

test('fails closed when a same-inode, same-size Compose definition mutates after capture', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-consumer-snapshot-content-race-'))
  );
  const compose = join(directory, 'compose.yaml');
  const marker = join(directory, 'mutated');
  const initial =
    'services:\n  app:\n    environment:\n      OLLAMA_HOST: 11434\n';
  const replacement = initial.replace('OLLAMA', 'AAAAAA');
  try {
    assert.equal(initial.length, replacement.length);
    await writeFile(compose, initial);
    await assert.rejects(
      execFileAsync('sh', [
        '-c',
        `${prelude}. "$1"; SCRIPT_DIR=$(dirname "$1"); COMPOSE_ROOTS="$2"; definition=$3; marker=$4; replacement=$5; init_temp_root; trap cleanup_temp EXIT; load_consumer_scanners; consumer_matches() { /usr/bin/grep -q -Ei 'ollama|11434' "$1"; status=$?; if [ ! -e "$marker" ]; then : >"$marker"; /usr/bin/printf '%s' "$replacement" >"$definition"; fi; return "$status"; }; scan_compose_definitions`,
        'retire-ollama-consumer-snapshot-content-race-test',
        script.pathname,
        directory,
        compose,
        marker,
        replacement,
      ]),
      (error) => error.code === 2
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('fails closed when a captured Compose definition is replaced with a symlink', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-consumer-snapshot-symlink-'))
  );
  const compose = join(directory, 'compose.yaml');
  const replacement = join(directory, 'replacement.yaml');
  const marker = join(directory, 'swapped');
  try {
    await Promise.all([
      writeFile(
        compose,
        'services:\n  app:\n    environment:\n      OLLAMA_HOST: http://127.0.0.1:11434\n'
      ),
      writeFile(
        replacement,
        'services:\n  app:\n    environment:\n      OTHER: 1\n'
      ),
    ]);
    await assert.rejects(
      execFileAsync('sh', [
        '-c',
        'RETIRE_OLLAMA_TEST_BIN=/usr/bin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; . "$1"; SCRIPT_DIR=$(dirname "$1"); COMPOSE_ROOTS="$2"; replacement=$3; definition=$4; marker=$5; init_temp_root; trap cleanup_temp EXIT; load_consumer_scanners; stat() { printf "1:2:81a4:10:501:20:644\\n"; }; findmnt() { printf "/ fixture apfs ro\\n"; }; consumer_matches() { /usr/bin/grep -q -Ei "ollama|11434" "$1"; status=$?; if [ ! -e "$marker" ]; then : >"$marker"; rm -f "$definition"; ln -s "$replacement" "$definition"; fi; return "$status"; }; scan_compose_definitions',
        'retire-ollama-consumer-snapshot-symlink-test',
        script.pathname,
        directory,
        replacement,
        compose,
        marker,
      ]),
      (error) => error.code === 2
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects a noncanonical regular-file alias before consumer capture', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-consumer-canonical-alias-'))
  );
  const target = join(directory, 'target.yaml');
  const nested = join(directory, 'nested');
  const alias = `${nested}/../target.yaml`;
  try {
    await Promise.all([mkdir(nested), writeFile(target, 'services: {}\n')]);
    await assert.rejects(
      execFileAsync('sh', [
        '-c',
        'RETIRE_OLLAMA_TEST_BIN=/usr/bin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; . "$1"; SCRIPT_DIR=$(dirname "$1"); init_temp_root; trap cleanup_temp EXIT; load_consumer_scanners; consumer_canonical_regular "$2"',
        'retire-ollama-consumer-canonical-alias-test',
        script.pathname,
        alias,
      ]),
      (error) => error.code === 2
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
