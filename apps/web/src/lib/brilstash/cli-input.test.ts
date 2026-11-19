import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { readBrilStashCliInput } from './cli-input';

let directory: string;
let inputPath: string;
const input = { fixture: true };

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'brilstash-cli-input-'));
  inputPath = join(directory, 'input.json');
  await writeFile(inputPath, JSON.stringify(input));
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

it('requires the exact --apply switch to opt in to writes', async () => {
  await expect(readBrilStashCliInput([inputPath])).resolves.toEqual({
    input,
    apply: false,
  });
  await expect(readBrilStashCliInput([inputPath, '--apply'])).resolves.toEqual({
    input,
    apply: true,
  });
  await expect(readBrilStashCliInput([inputPath, '--other'])).rejects.toThrow(
    'Expected an input JSON file'
  );
  await expect(readBrilStashCliInput(['--apply', inputPath])).rejects.toThrow(
    'Expected an input JSON file'
  );
});

it('rejects missing files, directories, oversized files, and invalid JSON', async () => {
  const oversized = join(directory, 'large.json');
  const malformed = join(directory, 'malformed.json');
  await Promise.all([
    writeFile(oversized, ' '.repeat(262145)),
    writeFile(malformed, '{'),
  ]);
  for (const path of [
    directory,
    join(directory, 'missing.json'),
    oversized,
    malformed,
  ]) {
    await expect(readBrilStashCliInput([path])).rejects.toThrow(
      'Unable to read BrilStash input file'
    );
  }
});

it('accepts a valid JSON file at the byte limit and rejects one extra byte', async () => {
  const boundary = join(directory, 'boundary.json');
  const body = JSON.stringify({
    payload: 'x'.repeat(262144 - '{"payload":""}'.length),
  });
  expect(Buffer.byteLength(body)).toBe(262144);
  await writeFile(boundary, body);
  await expect(readBrilStashCliInput([boundary])).resolves.toEqual({
    input: JSON.parse(body),
    apply: false,
  });
  await writeFile(boundary, `${body}\n`);
  await expect(readBrilStashCliInput([boundary])).rejects.toThrow(
    'Unable to read BrilStash input file'
  );
});

it('rejects a symbolic link to an otherwise valid input file', async () => {
  const link = join(directory, 'linked-input.json');
  await symlink(inputPath, link);
  await expect(readBrilStashCliInput([link])).rejects.toThrow(
    'Unable to read BrilStash input file'
  );
});
