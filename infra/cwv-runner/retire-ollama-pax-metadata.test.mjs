import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const imageHelper = new URL(
  './retire-ollama-image-filesystem.pl',
  import.meta.url
);
const runningHelper = new URL(
  './retire-ollama-running-container-validation.sh',
  import.meta.url
);

function octal(value, width, suffix = '\0') {
  return `${value.toString(8).padStart(width - suffix.length, '0')}${suffix}`;
}

function tarEntry({ name, type = '0', bytes = Buffer.alloc(0) }) {
  const header = Buffer.alloc(512);
  Buffer.from(name).copy(header, 0, 0, 100);
  header.write(octal(0o644, 8), 100);
  header.write(octal(0, 8), 108);
  header.write(octal(0, 8), 116);
  header.write(octal(bytes.length, 12), 124);
  header.fill(0x20, 148, 156);
  header[156] = type.charCodeAt(0);
  header.write('ustar\0', 257, 'ascii');
  header.write('00', 263, 'ascii');
  header.write(
    octal(
      header.reduce((sum, byte) => sum + byte, 0),
      8,
      '\0 '
    ),
    148
  );
  return Buffer.concat([
    header,
    bytes,
    Buffer.alloc((512 - (bytes.length % 512)) % 512),
  ]);
}

function archive(entries) {
  return Buffer.concat([...entries, Buffer.alloc(1024)]);
}

function paxRecord(key, value) {
  const body = Buffer.from(`${key}=${value}\n`);
  let length = body.length + 2;
  while (true) {
    const next = String(length).length + 1 + body.length;
    if (next === length)
      return Buffer.concat([Buffer.from(`${length} `), body]);
    length = next;
  }
}

const dependencyMetadata = paxRecord(
  'SCHILY.xattr.user.config',
  'upstream=http://127.0.0.1:11434'
);
const cleanLayer = archive([
  tarEntry({ name: 'pax', type: 'x', bytes: dependencyMetadata }),
  tarEntry({ name: 'etc/application.conf', bytes: Buffer.from('clean') }),
]);

test('detects an Ollama endpoint stored in image-layer PAX metadata', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-image-pax-metadata-'));
  const image = join(directory, 'image.tar');
  try {
    await writeFile(
      image,
      archive([
        tarEntry({ name: 'layer.tar', bytes: cleanLayer }),
        tarEntry({
          name: 'manifest.json',
          bytes: Buffer.from(
            JSON.stringify([{ Config: 'config.json', Layers: ['layer.tar'] }])
          ),
        }),
      ]),
      { mode: 0o600 }
    );
    const result = await execFileAsync('/usr/bin/perl', [
      imageHelper.pathname,
      image,
      directory,
    ]);
    assert.equal(result.stdout.trim(), '1');
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('detects an Ollama endpoint stored in exported PAX metadata', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-export-pax-metadata-'));
  const image = join(directory, 'filesystem.tar');
  try {
    await writeFile(image, cleanLayer);
    await execFileAsync('sh', [
      '-c',
      '. "$1"; running_container_archive_matches "$2"',
      'running-container-pax-metadata',
      runningHelper.pathname,
      image,
    ]);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('rejects malformed PAX metadata in images and exports', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-malformed-pax-metadata-')
  );
  const image = join(directory, 'image.tar');
  const exported = join(directory, 'filesystem.tar');
  const malformedLayer = archive([
    tarEntry({
      name: 'pax',
      type: 'x',
      bytes: Buffer.from('99 SCHILY.xattr.user.config=ollama\n'),
    }),
    tarEntry({ name: 'etc/application.conf', bytes: Buffer.from('clean') }),
  ]);
  try {
    await writeFile(
      image,
      archive([
        tarEntry({ name: 'layer.tar', bytes: malformedLayer }),
        tarEntry({
          name: 'manifest.json',
          bytes: Buffer.from(
            JSON.stringify([{ Config: 'config.json', Layers: ['layer.tar'] }])
          ),
        }),
      ]),
      { mode: 0o600 }
    );
    await assert.rejects(
      execFileAsync('/usr/bin/perl', [imageHelper.pathname, image, directory])
    );

    await writeFile(exported, malformedLayer);
    await assert.rejects(
      execFileAsync('sh', [
        '-c',
        '. "$1"; running_container_archive_matches "$2"',
        'running-container-malformed-pax-metadata',
        runningHelper.pathname,
        exported,
      ]),
      (error) => error.code === 2
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
