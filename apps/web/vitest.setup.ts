import { beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom';
import React from 'react';
import { resetProviderCooldowns } from '@/ai/provider-cooldown';

vi.mock('server-only', () => ({}));

type MockImageSrc = string | { src: string } | { default: { src: string } };

type MockNextImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  src?: MockImageSrc;
  alt?: string;
};

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

process.env.NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://mock.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'mock-anon-key';

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

function normalizeMockImageSrc(src?: MockImageSrc): string | undefined {
  return typeof src === 'string'
    ? src
    : src && 'default' in src
      ? src.default.src
      : src?.src;
}

// Mock Next.js Image component
vi.mock('next/image', () => ({
  default: ({ src, alt, ...props }: MockNextImageProps) =>
    React.createElement('img', {
      src: normalizeMockImageSrc(src),
      alt,
      ...props,
    }),
  // `getImageProps` powers the per-format `<picture>` pipeline (CdnFormatImage /
  // ogabassey-image-format-sources). Mirror the default mock: raw-src
  // passthrough with NO srcSet, so CdnFormatImage's AVIF-tier derivation finds
  // no transform twin and renders a plain <img> — identical to the default mock
  // above and to the pre-migration `<Image>`. Tests asserting the REAL
  // per-format srcSet re-mock next/image with `importOriginal` in-file.
  getImageProps: ({
    src,
    alt,
    fill: _fill,
    priority: _priority,
    loader: _loader,
    quality: _quality,
    preload: _preload,
    ...props
  }: MockNextImageProps & {
    fill?: boolean;
    priority?: boolean;
    loader?: unknown;
    quality?: number;
    preload?: boolean;
  }) => ({
    props: { ...props, src: normalizeMockImageSrc(src), alt: alt ?? '' },
  }),
}));

// The AI provider chain parks rate-limited providers in a module-level
// cooldown Map (src/ai/provider-cooldown.ts). Any test that simulates a
// quota/429 rejection would otherwise leak that cooldown into the tests that
// follow it in the same file, silently changing which provider the chain
// attempts. Reset it globally so each test starts from a clean chain.
beforeEach(() => {
  resetProviderCooldowns();
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
