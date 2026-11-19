// @vitest-environment node
import { readFileSync } from 'node:fs';
import { transformSync } from 'next/dist/build/swc';
import { expect, it } from 'vitest';

it('remounts the draft session on a dev refresh instead of reusing an incompatible hook layout', () => {
  const source = readFileSync(
    new URL('./OxygenCustomerForm.tsx', import.meta.url),
    'utf8'
  );
  const output = transformSync(source, {
    filename: 'OxygenCustomerForm.tsx',
    jsc: {
      parser: { syntax: 'typescript', tsx: true },
      transform: {
        react: { runtime: 'automatic', development: true, refresh: true },
      },
    },
  });
  // The draft hook changed its useRef count during the observed live update.
  // React Refresh must remount this boundary, not retain the old hook slots.
  expect(output.code).toMatch(/\w+\(OxygenDraftSession,\s*"[^"]+",\s*true,/);
});
