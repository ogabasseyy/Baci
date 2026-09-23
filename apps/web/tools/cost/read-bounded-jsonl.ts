import { createReadStream } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import {
  MAX_INPUT_BYTES,
  MAX_INPUT_ROWS,
} from './measure-vercel-storefront-cost-types';

export interface BoundedJsonlResult {
  bytes: Uint8Array;
  rows: unknown[];
}

function parseLine(line: string, label: string, rows: unknown[]) {
  if (!line.trim()) return;
  if (rows.length >= MAX_INPUT_ROWS)
    throw new Error(`${label} exceeds the ${MAX_INPUT_ROWS}-row bound`);
  try {
    rows.push(JSON.parse(line));
  } catch {
    throw new Error(`${label} contains invalid JSON`);
  }
}

/** Reads bounded JSONL without loading an untrusted file before validation. */
export async function readBoundedJsonl(
  path: string,
  label: string
): Promise<BoundedJsonlResult> {
  const stream = createReadStream(path);
  const decoder = new StringDecoder('utf8');
  const chunks: Buffer[] = [];
  const rows: unknown[] = [];
  let pendingLine = '';
  let byteLength = 0;

  const consumeText = (text: string) => {
    pendingLine += text;
    let newlineIndex = pendingLine.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = pendingLine.slice(0, newlineIndex).replace(/\r$/, '');
      pendingLine = pendingLine.slice(newlineIndex + 1);
      parseLine(line, label, rows);
      newlineIndex = pendingLine.indexOf('\n');
    }
  };

  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      byteLength += buffer.byteLength;
      if (byteLength > MAX_INPUT_BYTES) {
        throw new Error(`${label} exceeds the ${MAX_INPUT_BYTES}-byte bound`);
      }
      chunks.push(buffer);
      consumeText(decoder.write(buffer));
    }
    consumeText(decoder.end());
    parseLine(pendingLine, label, rows);
  } finally {
    if (!stream.destroyed) stream.destroy();
  }

  return { bytes: Buffer.concat(chunks, byteLength), rows };
}
