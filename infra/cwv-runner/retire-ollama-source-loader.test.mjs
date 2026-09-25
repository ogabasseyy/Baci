import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  copyFile,
  mkdtemp,
  readdir,
  readFile,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const runnerDir = new URL('.', import.meta.url);
const copyLoader = (directory, loader = 'retire-ollama-source-loader.sh') =>
  copyFile(new URL(`./${loader}`, runnerDir), join(directory, loader));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const invokeLoader = (
  directory,
  source,
  command,
  loader = 'retire-ollama-source-loader.sh'
) =>
  execFileAsync(
    'sh',
    ['-c', command, 'loader-test', join(directory, loader), source],
    { cwd: directory }
  );
const loaderCommand =
  '. "$1"; source_loader_source "$2"; printf "%s\\n" "$SOURCE_EVENTS"';
const digestCommand = `. "$1"; SOURCE_LOADER_DIGEST=stale; if source_loader_source "$2"; then status=0; else status=$?; fi; printf "%s|%s|%s\\n" "$status" "$SOURCE_LOADER_DIGEST" "\${SOURCE_EVENTS-}"`;
const runDigestLoader = (directory, source, loader) =>
  invokeLoader(directory, source, digestCommand, loader);
test('uses distinct held descriptors for nested source loads', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-source-loader-depth-'));
  const leaf = join(directory, 'leaf.sh');
  const nested = join(directory, 'nested.sh');
  const root = join(directory, 'root.sh');
  await copyLoader(directory);
  await writeFile(leaf, `SOURCE_EVENTS="\${SOURCE_EVENTS:-}L"\n`);
  await writeFile(
    nested,
    `SOURCE_EVENTS="\${SOURCE_EVENTS:-}N"\nsource_loader_source "${leaf}"\n`
  );
  await writeFile(
    root,
    `SOURCE_EVENTS="\${SOURCE_EVENTS:-}R"\nsource_loader_source "${nested}"\nSOURCE_EVENTS="\${SOURCE_EVENTS:-}r"\n`
  );
  const { stdout } = await invokeLoader(directory, root, loaderCommand);
  assert.equal(stdout.trim(), 'RNLr');
});
test('restores the outer digest after a nested source load', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-source-loader-digest-'));
  const nested = join(directory, 'nested.sh');
  const root = join(directory, 'root.sh');
  await copyLoader(directory);
  const nestedBytes = `SOURCE_EVENTS="\${SOURCE_EVENTS:-}N"\n`;
  const rootBytes = [
    `SOURCE_EVENTS="\${SOURCE_EVENTS:-}R"`,
    `source_loader_source "${nested}"`,
    'NESTED_SOURCE_LOADER_DIGEST=$SOURCE_LOADER_DIGEST',
    `SOURCE_EVENTS="\${SOURCE_EVENTS:-}r"`,
    '',
  ].join('\n');
  await writeFile(nested, nestedBytes);
  await writeFile(root, rootBytes);
  const { stdout } = await invokeLoader(
    directory,
    root,
    '. "$1"; source_loader_source "$2"; printf "%s|%s|%s\\n" "$SOURCE_EVENTS" "$NESTED_SOURCE_LOADER_DIGEST" "$SOURCE_LOADER_DIGEST"'
  );
  assert.equal(
    stdout.trim(),
    `RNr|${sha256(nestedBytes)}|${sha256(rootBytes)}`
  );
});
test('clears the digest when source execution fails', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-source-loader-failure-')
  );
  const source = join(directory, 'source.sh');
  await copyLoader(directory);
  await writeFile(source, 'SOURCE_EVENTS=ran\nfalse\n');
  const { stdout } = await runDigestLoader(
    directory,
    source,
    'retire-ollama-source-loader.sh'
  );
  assert.equal(stdout.trim(), '1||ran');
});
test('cleans snapshots when descriptor validation fails', async () => {
  const identityPattern = /source_loader_fd_identity=\$\(.*?\) \|\| \{/;
  for (const loaderName of [
    'retire-ollama-source-loader.sh',
    'retire-ollama.sh',
  ]) {
    const loaderBytes = await readFile(
      new URL(`./${loaderName}`, runnerDir),
      'utf8'
    );
    for (const replacement of [
      'source_loader_fd_identity=$(false) || {',
      'source_loader_fd_identity=mismatch || {',
    ]) {
      const directory = await mkdtemp(
        join(tmpdir(), 'baci-source-loader-cleanup-')
      );
      const loader = join(directory, loaderName);
      const source = join(directory, 'source.sh');
      await writeFile(
        loader,
        loaderBytes.replace(identityPattern, replacement)
      );
      await writeFile(source, ':\n');
      const { stdout } = await runDigestLoader(directory, source, loaderName);
      assert.equal(stdout.trim(), '2||');
      assert.deepEqual(
        (await readdir(directory)).filter((name) =>
          name.startsWith('.retire-ollama-source.')
        ),
        []
      );
    }
  }
});
test('selects fixed digest tools and rejects tool or digest failures', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-source-loader-shasum-'));
  const source = join(directory, 'source.sh');
  const fixedTool = join(directory, 'sha256sum.sh');
  const fallbackTool = join(directory, 'shasum.sh');
  const missingTool = join(directory, 'missing-sha256sum');
  const digest = 'a'.repeat(64);
  await writeFile(source, 'SOURCE_EVENTS=ran\n');
  await writeFile(
    fallbackTool,
    `#!/bin/sh\nprintf '%s  %s\\n' '${digest}' "$2"\n`
  );
  await chmod(fallbackTool, 0o755);
  for (const [fixedPath, fixedBody, expected] of [
    [missingTool, null, `0|${digest}|ran`],
    [fixedTool, `printf '%s  %s\\n' '${digest}' "$2"\nexit 7`, '2||'],
    [fixedTool, `printf '%s  %s\\n' 'a' "$2"\nexit 0`, '2||'],
  ]) {
    if (fixedBody) {
      await writeFile(fixedTool, `#!/bin/sh\n${fixedBody}\n`);
      await chmod(fixedTool, 0o755);
    }
    for (const loaderName of [
      'retire-ollama-source-loader.sh',
      'retire-ollama.sh',
    ]) {
      const loader = join(directory, loaderName);
      const bytes = await readFile(
        new URL(`./${loaderName}`, runnerDir),
        'utf8'
      );
      await writeFile(
        loader,
        bytes
          .replaceAll('/usr/bin/sha256sum', fixedPath)
          .replaceAll('/usr/bin/shasum', fallbackTool)
      );
      const { stdout } = await runDigestLoader(directory, source, loaderName);
      assert.equal(stdout.trim(), expected);
    }
  }
});
test('keeps the bootstrap and external source loaders behaviorally aligned', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-source-loader-parity-'));
  const recovery = join(directory, 'retire-ollama-recovery.sh');
  const leaf = join(directory, 'leaf.sh');
  const nested = join(directory, 'nested.sh');
  const root = join(directory, 'root.sh');
  await copyLoader(directory);
  await copyLoader(directory, 'retire-ollama.sh');
  await writeFile(recovery, ':\n');
  await writeFile(leaf, `SOURCE_EVENTS="\${SOURCE_EVENTS:-}L"\n`);
  await writeFile(
    nested,
    `SOURCE_EVENTS="\${SOURCE_EVENTS:-}N"\nsource_loader_source "${leaf}"\n`
  );
  await writeFile(
    root,
    `SOURCE_EVENTS="\${SOURCE_EVENTS:-}R"\nsource_loader_source "${nested}"\nSOURCE_EVENTS="\${SOURCE_EVENTS:-}r"\n`
  );
  const [externalResult, bootstrapResult] = await Promise.all([
    invokeLoader(directory, root, loaderCommand),
    invokeLoader(directory, root, loaderCommand, 'retire-ollama.sh'),
  ]);
  assert.equal(externalResult.stdout.trim(), 'RNLr');
  assert.equal(bootstrapResult.stdout, externalResult.stdout);
});
test('allows timestamp changes caused by truncating the snapshot target', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-source-loader-target-'));
  const loader = join(directory, 'retire-ollama-source-loader.sh');
  const source = join(directory, 'source.sh');
  const target = join(directory, 'target.sh');
  await copyLoader(directory);
  await writeFile(source, 'SOURCE_EVENTS=A\n');
  await writeFile(target, '');
  await utimes(target, new Date(0), new Date(0));
  await execFileAsync(
    'sh',
    [
      '-c',
      '. "$1"; source_loader_snapshot_file "$2" "$3"',
      'loader-target-test',
      loader,
      source,
      target,
    ],
    { cwd: directory }
  );
  assert.equal(await readFile(target, 'utf8'), 'SOURCE_EVENTS=A\n');
});
test('snapshots the held source instead of trusting a restored pathname', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-source-loader-swap-'));
  const source = join(directory, 'helper.sh');
  const saved = join(directory, 'helper.a.sh');
  const alternate = join(directory, 'helper.b.sh');
  await copyLoader(directory);
  await writeFile(source, `SOURCE_EVENTS="\${SOURCE_EVENTS}A"\n`);
  await writeFile(alternate, `SOURCE_EVENTS="\${SOURCE_EVENTS}B"\n`);
  const script = [
    '. "$1"',
    'hash_tool=$(command -v sha256sum 2>/dev/null || command -v shasum 2>/dev/null) || exit 127',
    'hash_file() { case "$hash_tool" in *shasum) "$hash_tool" -a 256 "$1";; *) "$hash_tool" "$1";; esac | awk \'{print $1}\'; }',
    'before=$(hash_file "$2")',
    'mv "$2" "$4"; mv "$3" "$2"; . "$2"; mv "$2" "$3"; mv "$4" "$2"',
    'after=$(hash_file "$2")',
    'printf "pathname:%s:%s:%s\\n" "$before" "$after" "$SOURCE_EVENTS"',
    'SOURCE_EVENTS=',
    'source_loader_source "$2"',
    'printf "held:%s\\n" "$SOURCE_EVENTS"',
  ].join('\n');
  const { stdout } = await execFileAsync(
    'sh',
    [
      '-c',
      script,
      'swap-test',
      join(directory, 'retire-ollama-source-loader.sh'),
      source,
      alternate,
      saved,
    ],
    { cwd: directory }
  );
  const lines = stdout.trim().split('\n');
  const [, before, after, pathnameEvents] = lines[0].split(':');
  assert.match(before, /^[0-9a-f]{64}$/);
  assert.match(after, /^[0-9a-f]{64}$/);
  assert.equal(before, after);
  assert.equal(pathnameEvents, 'B');
  assert.equal(lines[1], 'held:A');
});
test('does not execute a replaced external loader during main bootstrap', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-source-loader-bootstrap-')
  );
  const main = join(directory, 'retire-ollama.sh');
  const recovery = join(directory, 'retire-ollama-recovery.sh');
  const external = join(directory, 'retire-ollama-source-loader.sh');
  const marker = join(directory, 'loader-ran');
  const mainBytes = await readFile(
    new URL('./retire-ollama.sh', runnerDir),
    'utf8'
  );
  const consumerBytes = await readFile(
    new URL('./retire-ollama-consumers.sh', runnerDir),
    'utf8'
  );
  const receiptBytes = await readFile(
    new URL('./retire-ollama-recovery-receipts.sh', runnerDir),
    'utf8'
  );
  assert.match(mainBytes, /source_loader_source\(\)/);
  assert.doesNotMatch(mainBytes, /\.\s+"\$SOURCE_LOADER"/);
  assert.doesNotMatch(mainBytes, /\.\s+"\$helper"/);
  assert.match(mainBytes, /source_loader_source "\$helper"/);
  assert.doesNotMatch(consumerBytes, /\.\s+"\$consumer_mount_helper"/);
  assert.match(consumerBytes, /source_loader_source "\$consumer_mount_helper"/);
  assert.match(receiptBytes, /RECOVERY_RECEIPTS_LOADED_SHA/);
  assert.match(receiptBytes, /CONSUMER_MOUNTS_LOADED_SHA/);
  await writeFile(main, mainBytes);
  await writeFile(recovery, ':\n');
  await writeFile(external, `printf x >"${marker}"\n`);
  await execFileAsync(
    'sh',
    ['-c', '. "$1"; test ! -e "$2"', 'bootstrap-probe', main, marker],
    { cwd: directory }
  );
});
