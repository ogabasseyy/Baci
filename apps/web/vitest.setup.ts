import { beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom';
import { installSharedTestSetup } from './vitest.setup.shared';

// Setup for the `jsdom` Vitest project (see vitest.config.ts). Tests that need
// no DOM run in the `node` project with vitest.setup.node.ts instead, which
// loads this file only when a test opts into jsdom with a docblock.
vi.mock('server-only', () => ({}));

async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.stream === 'function') {
    const reader = blob.stream().getReader();
    const chunks: Uint8Array[] = [];
    let totalLength = 0;

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      if (value) {
        chunks.push(value);
        totalLength += value.byteLength;
      }
    }

    const bytes = new Uint8Array(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return bytes.buffer;
  }

  if (typeof FileReader !== 'undefined') {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();

      reader.onerror = () => {
        reject(reader.error ?? new Error('Failed to read blob'));
      };

      reader.onload = () => {
        const result = reader.result;

        if (result instanceof ArrayBuffer) {
          resolve(result);
          return;
        }

        reject(new Error('Unexpected FileReader result'));
      };

      reader.readAsArrayBuffer(blob);
    });
  }

  return new TextEncoder().encode(await blob.text()).buffer;
}

if (typeof Blob !== 'undefined' && !Blob.prototype.arrayBuffer) {
  Object.defineProperty(Blob.prototype, 'arrayBuffer', {
    configurable: true,
    writable: true,
    value: function arrayBuffer(this: Blob) {
      return blobToArrayBuffer(this);
    },
  });
}

if (typeof File !== 'undefined' && !File.prototype.arrayBuffer) {
  Object.defineProperty(File.prototype, 'arrayBuffer', {
    configurable: true,
    writable: true,
    value: function arrayBuffer(this: File) {
      return blobToArrayBuffer(this);
    },
  });
}

if (typeof window !== 'undefined') {
  // Radix FocusScope creates CustomEvent from the global constructor; jsdom
  // EventTargets require events from the window realm.
  Object.defineProperty(globalThis, 'Event', {
    configurable: true,
    writable: true,
    value: window.Event,
  });
  Object.defineProperty(globalThis, 'CustomEvent', {
    configurable: true,
    writable: true,
    value: window.CustomEvent,
  });
}

// Patch Blob stream for Undici in Vitest
if (typeof Blob !== 'undefined' && !Blob.prototype.stream) {
  Blob.prototype.stream = function () {
    const reader = new FileReader();
    reader.readAsArrayBuffer(this);
    return new ReadableStream({
      start(controller) {
        reader.onload = () => {
          if (reader.result instanceof ArrayBuffer) {
            controller.enqueue(new Uint8Array(reader.result));
          }
          controller.close();
        };
        reader.onerror = () => {
          controller.error(new Error('Failed to read blob'));
        };
      },
    });
  };
}

// Mock Next.js Image component (factory shared with the node project setup)
vi.mock('next/image', async () => {
  const { createNextImageMock } = await import('./vitest.next-image-mock');
  return createNextImageMock();
});

// Env defaults, provider-cooldown reset and deterministic UUIDs.
installSharedTestSetup();

beforeEach(() => {
  // jsdom's navigator has no Web Locks API (Node's own navigator does).
  if (!navigator.locks) {
    const heldLocks = new Set<string>();
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: async (
          name: string,
          _options: unknown,
          callback: (lock: Lock | null) => Promise<unknown>
        ) => {
          if (heldLocks.has(name)) return callback(null);
          heldLocks.add(name);
          try {
            return await callback({ name, mode: 'exclusive' } as Lock);
          } finally {
            heldLocks.delete(name);
          }
        },
      } as unknown as LockManager,
    });
  }
});
