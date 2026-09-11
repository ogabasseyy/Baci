import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);
const containerId = '0123456789abcdef'.repeat(4);
const prelude =
  'RETIRE_OLLAMA_TEST_BIN=/usr/bin; native_sha256sum=$(command -v sha256sum 2>/dev/null || :); native_shasum=$(command -v shasum 2>/dev/null || :); sha256sum() { if [ -n "$native_sha256sum" ]; then "$native_sha256sum" "$@"; elif [ -n "$native_shasum" ]; then "$native_shasum" -a 256 "$@"; else return 2; fi; }; findmnt() { printf "/ fixture apfs ro\\n"; }; ';

function scanContainer(
  directory,
  wrapperBody,
  configurationBody = 'endpoint=http://127.0.0.1:11434\n',
  nestedBody = '',
  executable = false,
  inspectCleanup = false
) {
  return execFileAsync('sh', [
    '-c',
    `${prelude}wrapper_body=$3; configuration_body=$4; nested_body=$5; executable=$6; inspect_cleanup=$7; stat() { if [ "$executable" = 1 ]; then printf '1:2:81ed:10:0:0:755\\n'; else printf '1:2:81a4:10:0:0:600\\n'; fi; }; docker() { case "$*" in *' ps -a '*) printf '${containerId}\\n' ;; *'inspect -f {{.Name}} ${containerId}') printf '/generic-api\\n' ;; *'inspect -f {{json .State.Running}} ${containerId}') printf 'false\\n' ;; *'inspect -f {{.Id}} '*) printf '${containerId} /generic-api /opt/application-wrapper [] [] {} null [] {} {} {} [] "bridge"\\n' ;; *'inspect -f {{json .Mounts}} ${containerId}') printf '[]\\n' ;; *' cp ${containerId}:/opt/application-wrapper '*) for destination do :; done; printf '%s' "$wrapper_body" >"$destination" ;; *' cp ${containerId}:/etc/application.conf '*) for destination do :; done; printf '%s' "$configuration_body" >"$destination" ;; *' cp ${containerId}:/etc/nested.conf '*) for destination do :; done; printf '%s' "$nested_body" >"$destination" ;; *) return 2 ;; esac; }; . "$1"; SCRIPT_DIR=$(dirname "$1"); RETIRE_OLLAMA_TMPDIR="$2"; init_temp_root; trap cleanup_temp EXIT; CANONICAL_DOCKER_SOCKET=/run/docker.sock; CONTAINER=ollama-loopback; if [ "$inspect_cleanup" = 1 ]; then if scan_container_rows all >/dev/null; then scan_status=0; else scan_status=$?; fi; leaked=$(find "$TEMP_ROOT" -type f | wc -l | tr -d ' '); printf '%s %s\\n' "$scan_status" "$leaked"; else scan_container_rows all; fi`,
    'retire-ollama-container-wrapper-source-test',
    script.pathname,
    directory,
    wrapperBody,
    configurationBody,
    nestedBody,
    executable ? '1' : '0',
    inspectCleanup ? '1' : '0',
  ]);
}

for (const directive of [
  '. /etc/application.conf',
  'source /etc/application.conf',
]) {
  test(`binds a stopped-container wrapper ${directive.split(' ')[0]} source`, async () => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'baci-container-wrapper-source-'))
    );
    try {
      const { stdout } = await scanContainer(
        directory,
        `#!/bin/sh\n${directive}\n`
      );
      const records = stdout.trim().split('\n');
      assert.equal(records.length, 2);
      assert.match(records[0], /application-wrapper/);
      assert.match(records[1], /application\.conf/);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
}

for (const directive of [
  '. "$APPLICATION_CONFIG"',
  '. /tmp/../application.conf',
]) {
  test(`fails closed on unsafe stopped-container source ${directive}`, async () => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'baci-container-wrapper-unsafe-source-'))
    );
    try {
      await assert.rejects(
        scanContainer(directory, `#!/bin/sh\n${directive}\n`),
        (error) => error.code === 2
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
}

for (const directive of [
  'true; . /etc/application.conf',
  'if true; then source /etc/application.conf; fi',
]) {
  test(`fails closed on embedded stopped-container source ${directive}`, async () => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'baci-container-wrapper-embedded-source-'))
    );
    try {
      await assert.rejects(
        scanContainer(directory, `#!/bin/sh\n${directive}\n`),
        (error) => error.code === 2
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
}

test('recurses through a no-shebang stopped-container source', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-container-wrapper-nested-source-'))
  );
  try {
    const { stdout } = await scanContainer(
      directory,
      '#!/bin/sh\n. /etc/application.conf\n',
      '. /etc/nested.conf\n',
      'endpoint=http://127.0.0.1:11434\n'
    );
    const records = stdout.trim().split('\n');
    assert.equal(records.length, 3);
    assert.match(records[0], /application-wrapper/);
    assert.match(records[1], /application\.conf/);
    assert.match(records[2], /nested\.conf/);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('does not parse a no-shebang executable as shell source', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-container-no-shebang-executable-'))
  );
  try {
    const { stdout } = await scanContainer(
      directory,
      '. /etc/application.conf\n',
      'endpoint=http://127.0.0.1:11434\n',
      '',
      true
    );
    assert.equal(stdout, '');
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('binds a stopped-container source split by shell continuation', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-container-wrapper-source-continuation-'))
  );
  try {
    const { stdout } = await scanContainer(
      directory,
      '#!/bin/sh\nso\\\nurce /etc/application.conf\n'
    );
    const records = stdout.trim().split('\n');
    assert.equal(records.length, 2);
    assert.match(records[0], /application-wrapper/);
    assert.match(records[1], /application\.conf/);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('fails closed on an embedded source split by shell continuation', async () => {
  const directory = await realpath(
    await mkdtemp(
      join(tmpdir(), 'baci-container-embedded-source-continuation-')
    )
  );
  try {
    await assert.rejects(
      scanContainer(
        directory,
        '#!/bin/sh\ntrue; so\\\nurce /etc/application.conf\n'
      ),
      (error) => error.code === 2
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('fails closed on an unfinished source continuation', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-container-unfinished-source-'))
  );
  try {
    await assert.rejects(
      scanContainer(directory, '#!/bin/sh\nsource \\'),
      (error) => error.code === 2
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

for (const directive of [
  '\\. /tmp/hidden',
  "'source /etc/application.conf'",
  '`source /etc/application.conf`',
  '$source /etc/application.conf',
]) {
  test(`fails closed on interpreted source-like line ${directive}`, async () => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'baci-container-interpreted-source-'))
    );
    try {
      await assert.rejects(
        scanContainer(directory, `#!/bin/sh\n${directive}\n`),
        (error) => error.code === 2
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
}

test('cleans every traversal temporary after malformed source failure', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-container-source-cleanup-'))
  );
  try {
    const { stdout } = await scanContainer(
      directory,
      '#!/bin/sh\n. "$APPLICATION_CONFIG"\n',
      'endpoint=http://127.0.0.1:11434\n',
      '',
      false,
      true
    );
    assert.equal(stdout, '2 0\n');
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
