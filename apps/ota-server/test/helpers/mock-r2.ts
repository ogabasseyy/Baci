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
  customMetadata?: Record<string, string>;
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
  onBeforePut?: (key: string, options?: R2PutOptionsLike) => void;
  private writeCounter = 0;

  head(key: string): Promise<R2ObjectLike | null> {
    const entry = this.store.get(key);
    if (!entry) return Promise.resolve(null);
    return Promise.resolve({
      key,
      size: entry.bytes.byteLength,
      etag: entry.etag,
      httpEtag: `"${entry.etag}"`,
      httpMetadata: entry.httpMetadata,
      customMetadata: entry.customMetadata,
    });
  }

  get(key: string): Promise<R2ObjectBodyLike | null> {
    const entry = this.store.get(key);
    if (!entry) return Promise.resolve(null);
    const bytes = new Uint8Array(entry.bytes);
    return Promise.resolve({
      key,
      size: bytes.byteLength,
      etag: entry.etag,
      httpEtag: `"${entry.etag}"`,
      httpMetadata: entry.httpMetadata,
      customMetadata: entry.customMetadata,
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
    // Buffer before condition checks so concurrent puts on the same key remain atomic after await.
    const bytes = await toBytes(value);
    this.onBeforePut?.(key, options);
    const existing = this.store.get(key);
    if (options?.onlyIf) {
      if (options.onlyIf.etagDoesNotMatch !== undefined && existing) {
        if (
          options.onlyIf.etagDoesNotMatch === '*' ||
          options.onlyIf.etagDoesNotMatch === existing.etag
        ) {
          return null;
        }
      }
      if (options.onlyIf.etagMatches !== undefined) {
        if (
          options.onlyIf.etagMatches.startsWith('"') ||
          options.onlyIf.etagMatches.endsWith('"')
        ) {
          throw new Error(
            'R2 conditional etagMatches requires unquoted etag, not httpEtag'
          );
        }
        if (existing?.etag !== options.onlyIf.etagMatches) {
          return null;
        }
      }
    }

    this.writeCounter += 1;
    const etag = `${createHash('sha256').update(bytes).digest('hex').slice(0, 12)}-${this.writeCounter}`;
    this.store.set(key, {
      bytes: new Uint8Array(bytes),
      etag,
      httpMetadata: options?.httpMetadata,
      customMetadata: options?.customMetadata,
    });
    return {
      key,
      size: bytes.byteLength,
      etag,
      httpEtag: `"${etag}"`,
      httpMetadata: options?.httpMetadata,
      customMetadata: options?.customMetadata,
    };
  }

  delete(key: string): Promise<void> {
    this.store.delete(key);
    return Promise.resolve();
  }
}
