import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readBoundedJsonl } from './read-bounded-jsonl';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true }))
  );
});

describe('readBoundedJsonl', () => {
  it('parses CRLF and preserves UTF-8 rows while returning source bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bounded-jsonl-'));
    roots.push(root);
    const path = join(root, 'input.jsonl');
    const content = '{"message":"Ijele 🚀"}\r\n\r\n{"value":2}\n';
    await writeFile(path, content);

    await expect(readBoundedJsonl(path, 'fixture')).resolves.toEqual({
      bytes: Buffer.from(content),
      rows: [{ message: 'Ijele 🚀' }, { value: 2 }],
    });
  });

  it('rejects malformed JSON while reading the bounded stream', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bounded-jsonl-invalid-'));
    roots.push(root);
    const path = join(root, 'input.jsonl');
    await writeFile(path, '{"ok":true}\nnot-json\n');

    await expect(readBoundedJsonl(path, 'fixture')).rejects.toThrow(
      'fixture contains invalid JSON'
    );
  });
});
