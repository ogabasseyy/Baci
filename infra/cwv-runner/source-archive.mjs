import { createHash } from 'node:crypto';

import { canonicalJson } from './canonical-json.mjs';

const LIMITS = { archive: 16_777_216, member: 1_048_576, members: 1024 };
const fail = (message) => {
  throw new TypeError(message);
};
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const compare = (left, right) =>
  Buffer.compare(Buffer.from(left), Buffer.from(right));
function path(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.includes('\0') ||
    value.startsWith('/') ||
    Buffer.from(value).toString() !== value ||
    value.split('/').some((part) => !part || part === '.' || part === '..')
  )
    fail('invalid archive path');
  return value;
}
function mode(value) {
  if (value !== '100644' && value !== '100755') fail('invalid archive mode');
  return value;
}
function split(value) {
  if (Buffer.byteLength(value) <= 100) return ['', value];
  for (
    let index = value.lastIndexOf('/');
    index > 0;
    index = value.lastIndexOf('/', index - 1)
  ) {
    const prefix = value.slice(0, index);
    const name = value.slice(index + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100)
      return [prefix, name];
  }
  fail('tar path cannot be represented');
}
function octal(value, length, suffix = '\0') {
  const text = value.toString(8);
  if (text.length > length - suffix.length) fail('tar field overflow');
  return `${text.padStart(length - suffix.length, '0')}${suffix}`;
}
function header(entry) {
  const [prefix, name] = split(entry.path);
  const bytes = Buffer.alloc(512);
  bytes.write(name);
  bytes.write(octal(Number.parseInt(entry.mode.slice(-3), 8), 8), 100);
  bytes.write(octal(0, 8), 108);
  bytes.write(octal(0, 8), 116);
  bytes.write(octal(entry.bytes.length, 12), 124);
  bytes.write(octal(0, 12), 136);
  bytes.fill(0x20, 148, 156);
  bytes[156] = 0;
  bytes.write('ustar\0', 257);
  bytes.write('00', 263);
  bytes.write(prefix, 345);
  bytes.write(octal(0, 8), 329);
  bytes.write(octal(0, 8), 337);
  bytes.write(
    octal(
      bytes.reduce((total, byte) => total + byte, 0),
      8,
      '\0 '
    ),
    148
  );
  return bytes;
}
export function createSourceArchive(entries) {
  const members = entries.map((entry) => ({
    ...entry,
    path: path(entry.path),
    mode: mode(entry.mode),
  }));
  if (
    !members.length ||
    members.length > LIMITS.members ||
    members.some(
      (entry) =>
        !Buffer.isBuffer(entry.bytes) || entry.bytes.length > LIMITS.member
    ) ||
    members.some(
      (entry, index) =>
        index && compare(members[index - 1].path, entry.path) >= 0
    )
  )
    fail('invalid archive members');
  const archiveBytes = members.reduce(
    (total, entry) =>
      total +
      512 +
      entry.bytes.length +
      ((512 - (entry.bytes.length % 512)) % 512),
    1024
  );
  if (archiveBytes > LIMITS.archive) fail('archive exceeds size limit');
  const archive = Buffer.concat([
    ...members.flatMap((entry) => [
      header(entry),
      entry.bytes,
      Buffer.alloc((512 - (entry.bytes.length % 512)) % 512),
    ]),
    Buffer.alloc(1024),
  ]);
  if (archive.length !== archiveBytes) fail('archive size mismatch');
  return archive;
}
const zeros = (value) => value.every((byte) => byte === 0);
const field = (value, start, length) => {
  const bytes = value.subarray(start, start + length);
  const end = bytes.indexOf(0);
  const used = end < 0 ? bytes : bytes.subarray(0, end);
  const text = used.toString('utf8');
  if (
    (end >= 0 && !zeros(bytes.subarray(end))) ||
    !Buffer.from(text).equals(used)
  )
    fail('invalid tar utf8 field');
  return text;
};
function readOctal(value, start, length) {
  const raw = field(value, start, length);
  if (!/^[0-7]+$/.test(raw)) fail('invalid tar octal field');
  return Number.parseInt(raw, 8);
}
export function verifySourceArchive(archive, expectedEntries) {
  if (
    !Buffer.isBuffer(archive) ||
    archive.length < 1024 ||
    archive.length > LIMITS.archive ||
    archive.length % 512
  )
    fail('invalid archive bounds');
  const actual = [];
  for (let offset = 0; offset < archive.length; ) {
    const head = archive.subarray(offset, offset + 512);
    if (zeros(head)) {
      if (
        !zeros(archive.subarray(offset, offset + 1024)) ||
        offset + 1024 !== archive.length
      )
        fail('invalid tar terminator');
      break;
    }
    if (
      actual.length >= LIMITS.members ||
      head.toString('ascii', 257, 263) !== 'ustar\0' ||
      head.toString('ascii', 263, 265) !== '00' ||
      head[156] !== 0
    )
      fail('invalid tar header');
    const checksum = head.subarray(148, 156).toString('ascii');
    const copy = Buffer.from(head);
    copy.fill(0x20, 148, 156);
    if (
      !/^[0-7]{6}\0 $/.test(checksum) ||
      Number.parseInt(checksum.slice(0, 6), 8) !==
        copy.reduce((total, byte) => total + byte, 0) ||
      field(head, 265, 32) ||
      field(head, 297, 32) ||
      field(head, 329, 8) !== '0000000' ||
      field(head, 337, 8) !== '0000000'
    )
      fail('noncanonical tar metadata');
    const size = readOctal(head, 124, 12);
    const parsedMode = readOctal(head, 100, 8);
    const memberPath = `${field(head, 345, 155) ? `${field(head, 345, 155)}/` : ''}${field(head, 0, 100)}`;
    if (
      size > LIMITS.member ||
      readOctal(head, 108, 8) ||
      readOctal(head, 116, 8) ||
      readOctal(head, 136, 12)
    )
      fail('nonzero tar metadata');
    const [prefix, name] = split(path(memberPath));
    if (field(head, 345, 155) !== prefix || field(head, 0, 100) !== name)
      fail('noncanonical tar path');
    const start = offset + 512;
    const end = start + size;
    const padded = start + Math.ceil(size / 512) * 512;
    if (padded > archive.length || !zeros(archive.subarray(end, padded)))
      fail('invalid tar padding');
    const memberMode =
      parsedMode === 0o644
        ? '100644'
        : parsedMode === 0o755
          ? '100755'
          : fail('invalid tar mode');
    const memberBytes = archive.subarray(start, end);
    if (
      !head.equals(
        header({ path: memberPath, mode: memberMode, bytes: memberBytes })
      )
    )
      fail('noncanonical tar header');
    actual.push({
      path: memberPath,
      mode: memberMode,
      blobSha256: sha256(memberBytes),
    });
    offset = padded;
  }
  const expected = expectedEntries.map(
    ({ path: memberPath, mode: memberMode, blobSha256 }) => ({
      path: memberPath,
      mode: memberMode,
      blobSha256,
    })
  );
  if (canonicalJson(actual) !== canonicalJson(expected))
    fail('archive projection mismatch');
}
