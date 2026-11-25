import { createHash } from 'node:crypto';
import type {
  OtaR2Bucket,
  R2HttpMetadata,
  R2ObjectBodyLike,
  R2ObjectLike,
  R2PutOptionsLike,
} from '../../src/types';

interface StoredObject {
  bytes: Uint8Array;
  etag: string;
  httpMetadata?: R2HttpMetadata;
}

async function toBytes(
  value: ArrayBuffer | ArrayBufferView | string | ReadableStream<Uint8Array>
): Promise<Uint8Array> {
  if (typeof value === 'string') {
    return new TextEncoder().encode(value);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  const reader = value.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    chunks.push(chunk);
    total += chunk.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export class MockR2Bucket implements OtaR2Bucket {
  readonly store = new Map<string, StoredObject>();

  head(key: string): Promise<R2ObjectLike | null> {
    const entry = this.store.get(key);
    if (!entry) return Promise.resolve(null);
    return Promise.resolve({
      key,
      size: entry.bytes.byteLength,
      httpEtag: entry.etag,
      httpMetadata: entry.httpMetadata,
    });
  }

  get(key: string): Promise<R2ObjectBodyLike | null> {
    const entry = this.store.get(key);
    if (!entry) return Promise.resolve(null);
    const bytes = new Uint8Array(entry.bytes);
    return Promise.resolve({
      key,
      size: bytes.byteLength,
      httpEtag: entry.etag,
      httpMetadata: entry.httpMetadata,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
      text() {
        return Promise.resolve(new TextDecoder().decode(bytes));
      },
      json<T = unknown>() {
        return Promise.resolve(
          JSON.parse(new TextDecoder().decode(bytes)) as T
        );
      },
    });
  }

  async put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string | ReadableStream<Uint8Array>,
    options?: R2PutOptionsLike
  ): Promise<R2ObjectLike | null> {
    const bytes = await toBytes(value);
    const etag = `"${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}"`;
    this.store.set(key, {
      bytes: new Uint8Array(bytes),
      etag,
      httpMetadata: options?.httpMetadata,
    });
    return {
      key,
      size: bytes.byteLength,
      httpEtag: etag,
      httpMetadata: options?.httpMetadata,
    };
  }
}
