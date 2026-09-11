import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

function extractDockerFunction(command) {
  const match = /docker\(\)\s*\{/.exec(command);
  if (!match) return null;
  const open = match.index + match[0].length - 1;
  let depth = 1;
  let quote = null;
  let escaped = false;
  let comment = false;
  for (let index = open + 1; index < command.length; index += 1) {
    const character = command[index];
    if (comment) {
      if (character === '\n') comment = false;
      continue;
    }
    if (quote === "'") {
      if (character === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quote = null;
      continue;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    const previous = command[index - 1];
    if (character === '#' && (!previous || /[\s;|&(){}]/.test(previous))) {
      comment = true;
      continue;
    }
    if (character === "'") {
      quote = "'";
      continue;
    }
    if (character === '"') {
      quote = '"';
      continue;
    }
    if (character === '{') {
      depth += 1;
      continue;
    }
    if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        return command.slice(open + 1, index);
      }
    }
  }
  throw new Error('fixture docker function is incomplete');
}

export async function installDockerStub(bin, command, options = {}) {
  const body = extractDockerFunction(command);
  if (body === null) {
    throw new Error('fixture docker function is missing');
  }
  const archiveWrapper = options.wrapArchives
    ? [
        'case " $* " in',
        "  *' container export '*)",
        '    archive_stage=$(mktemp -d "$RETIRE_OLLAMA_TMPDIR/fixture-archive.XXXXXX") || exit 2',
        '    archive_capture="$archive_stage/fixture-archive"',
        '    docker "$@" >"$archive_capture" || { status=$?; rm -rf "$archive_stage"; exit "$status"; }',
        '    /usr/bin/touch -t 200001010000 "$archive_capture" || { rm -rf "$archive_stage"; exit 2; }',
        '    COPYFILE_DISABLE=1 /usr/bin/tar --no-xattrs --format=ustar --blocking-factor=1 -cf - -C "$archive_stage" fixture-archive',
        '    archive_status=$?',
        '    rm -rf "$archive_stage"',
        '    [ "$archive_status" -eq 0 ] || exit "$archive_status"',
        '    exit 0',
        '    ;;',
        'esac',
      ].join('\n')
    : '';
  await writeFile(
    join(bin, 'docker'),
    `#!/bin/sh\nif [ -z "\${RETIRE_OLLAMA_TMPDIR:-}" ]; then exit 2; fi\nsave_count="$RETIRE_OLLAMA_TMPDIR/save-count"\ndocker() {\n${body}\n}\n${archiveWrapper}\ndocker "$@"\n`,
    {
      mode: 0o755,
    }
  );
}

export async function installStatStub(stat) {
  await writeFile(
    stat,
    `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
let format = '%a';
let follow = false;
const paths = [];
let afterDoubleDash = false;
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === '-L') {
    follow = true;
    continue;
  }
  if (arg === '-c' || arg === '-Lc') {
    follow = follow || arg === '-Lc';
    format = args[index + 1] ?? format;
    index += 1;
    continue;
  }
  if (arg.startsWith('--format=')) {
    format = arg.slice('--format='.length);
    continue;
  }
  if (arg === '--') {
    afterDoubleDash = true;
    continue;
  }
  if (afterDoubleDash || !arg.startsWith('-')) paths.push(arg);
}
if (paths.length === 0) process.exit(2);
const describe = (stats) => {
  const type = stats.isDirectory()
    ? 'directory'
    : stats.isSymbolicLink()
      ? 'symbolic link'
      : stats.isFile()
        ? 'regular file'
        : 'unknown';
  const mode = stats.mode & 0xffff;
  return format
    .replaceAll('%u', String(stats.uid))
    .replaceAll('%g', String(stats.gid))
    .replaceAll('%a', (mode & 0o7777).toString(8))
    .replaceAll('%f', mode.toString(16).padStart(4, '0'))
    .replaceAll('%F', type)
    .replaceAll('%h', String(stats.nlink))
    .replaceAll('%s', String(stats.size))
    .replaceAll('%d', String(stats.dev))
    .replaceAll('%i', String(stats.ino));
};
const stat = follow ? fs.statSync : fs.lstatSync;
process.stdout.write(paths.map((path) => describe(stat(path))).join('\\n') + '\\n');
`,
    { mode: 0o755 }
  );
}
