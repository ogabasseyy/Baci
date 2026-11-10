import { Readable } from 'node:stream';
import { expect, it } from 'vitest';
import { readBoundedUtf8 } from './bounded-input.mjs';

it('preserves merchant Unicode when a UTF-8 character crosses every input chunk', async () => {
  const original = JSON.stringify({
    copy: '₦250 · Ọgá 😀',
    javascript: 'const title="Ọgá";',
  });
  const chunks = [...Buffer.from(original)].map((byte) => Buffer.from([byte]));
  expect(await readBoundedUtf8(Readable.from(chunks))).toBe(original);
});
it('counts decoded UTF-8 bytes against the unchanged input budget', async () => {
  const bytes = Buffer.from('₦x');
  await expect(
    readBoundedUtf8(
      Readable.from([...bytes].map((byte) => Buffer.from([byte]))),
      3
    )
  ).rejects.toThrow('Input budget');
  expect(await readBoundedUtf8(Readable.from([Buffer.from('₦')]), 3)).toBe('₦');
});
