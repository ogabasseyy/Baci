import { closeSync, fstatSync, openSync, readSync, statSync } from 'node:fs';
import { withDrainFileLock } from './drain-file-lock.mjs';
import { MAX_JSONL_READ_BYTES } from './vercel-error-events-limits.mjs';

function readFileTail(filePath, maxBytes) {
  const descriptor = openSync(filePath, 'r');
  let size;
  try {
    ({ size } = fstatSync(descriptor));
    const start = Math.max(0, size - maxBytes);
    const bytesToRead = size - start;
    const buffer = Buffer.allocUnsafe(bytesToRead);
    let bytesRead = 0;
    while (bytesRead < bytesToRead) {
      const count = readSync(
        descriptor,
        buffer,
        bytesRead,
        bytesToRead - bytesRead,
        start + bytesRead
      );
      if (count === 0) break;
      bytesRead += count;
    }

    let content = buffer.toString('utf8', 0, bytesRead);
    if (start > 0) {
      const previousByte = Buffer.alloc(1);
      const previousBytesRead = readSync(
        descriptor,
        previousByte,
        0,
        1,
        start - 1
      );
      if (previousBytesRead === 1 && previousByte[0] === 0x0a) {
        content = `\n${content}`;
      }
    }
    if (size > maxBytes && !content.startsWith('\n')) {
      const firstNewline = content.indexOf('\n');
      content = firstNewline === -1 ? '' : content.slice(firstNewline + 1);
    }
    return { bytesRead, content };
  } finally {
    closeSync(descriptor);
  }
}

function joinFileTails(chunks) {
  return chunks.reduce((combined, chunk) => {
    if (!combined) return chunk;
    if (!combined.endsWith('\n') && !chunk.startsWith('\n')) {
      return `${combined}\n${chunk}`;
    }
    return combined + chunk;
  }, '');
}

function fileSignatures(path, maxRotatedFiles) {
  const signatures = [];
  for (let index = 0; index <= maxRotatedFiles; index += 1) {
    const filePath = index === 0 ? path : `${path}.${index}`;
    try {
      const stats = statSync(filePath);
      signatures.push(
        `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeMs}`
      );
    } catch (error) {
      if (error?.code === 'ENOENT') {
        signatures.push(null);
        break;
      }
      throw error;
    }
  }
  return signatures;
}

function readDrainTailOnce(
  path,
  maxRotatedFiles,
  { readFileTailImpl = readFileTail } = {}
) {
  let remainingBytes = MAX_JSONL_READ_BYTES;
  const chunks = [];
  const active = readFileTailImpl(path, remainingBytes);
  chunks.push({ path, ...active });
  remainingBytes -= active.bytesRead;

  for (
    let index = 1;
    index <= maxRotatedFiles && remainingBytes > 0;
    index += 1
  ) {
    const rotatedPath = `${path}.${index}`;
    let rotated;
    try {
      rotated = readFileTailImpl(rotatedPath, remainingBytes);
    } catch (error) {
      if (error?.code === 'ENOENT') break;
      throw error;
    }
    chunks.unshift({ path: rotatedPath, ...rotated });
    remainingBytes -= rotated.bytesRead;
  }

  return joinFileTails(chunks.map(({ content }) => content));
}

export function readDrainTail(
  path,
  maxRotatedFiles,
  { fileSignaturesImpl = fileSignatures, readFileTailImpl = readFileTail } = {}
) {
  return withDrainFileLock(`${path}.lock`, () => {
    let content = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const before = fileSignaturesImpl(path, maxRotatedFiles);
      try {
        content = readDrainTailOnce(path, maxRotatedFiles, {
          readFileTailImpl,
        });
      } catch (error) {
        if (error?.code === 'ENOENT') continue;
        throw error;
      }
      const after = fileSignaturesImpl(path, maxRotatedFiles);
      if (
        before.length === after.length &&
        before.every((signature, index) => signature === after[index])
      ) {
        return content;
      }
    }
    throw new Error('Vercel drain changed while reading; retry later');
  });
}
