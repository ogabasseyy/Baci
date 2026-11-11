import { vi } from 'vitest';
import { installSharedTestSetup } from './vitest.setup.shared';

// Setup for the `node` Vitest project (see vitest.config.ts): API route,
// server and pure-logic tests that never touch a DOM. It skips everything
// vitest.setup.ts adds for jsdom (jest-dom matchers, Blob/Event/Web Locks
// shims, eager React), which is most of the per-file setup cost.
vi.mock('server-only', () => ({}));

vi.mock('next/image', async () => {
  const { createNextImageMock } = await import('./vitest.next-image-mock');
  return createNextImageMock();
});

if (typeof window !== 'undefined') {
  // This file opted into a DOM with `// @vitest-environment jsdom`. Give it
  // exactly what the jsdom project gives its tests.
  await import('./vitest.setup');
} else {
  installSharedTestSetup();
}
