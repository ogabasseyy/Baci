import { describe, expect, it } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-catalog-fixture';
import {
  compileStorefrontTailwindCss,
  extractTailwindCandidates,
} from './tailwind-css';

describe('tailwind-css', () => {
  it('extracts arbitrary Tailwind candidates, compiles nested relative CSS @imports, and rejects cyclic @imports', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.files = [
      { path: 'src/styles/sub.css', content: '.pill { border-width: 2px; }' },
      { path: 'src/styles/main.css', content: '@import "./sub.css";' },
      {
        path: 'src/StorefrontApp.tsx',
        content:
          'export default function App() { return <div className="bg-[#316ff6] pill" />; }',
      },
    ];
    expect(extractTailwindCandidates(manifest)).toContain('bg-[#316ff6]');
    const compiled = await compileStorefrontTailwindCss(manifest);
    expect(compiled.css).toContain('#316ff6');
    expect(compiled.css).toContain('.pill');

    const cyclic = createOgabasseyStorefrontManifest();
    cyclic.files = [
      { path: 'src/a.css', content: '@import "./b.css";' },
      { path: 'src/b.css', content: '@import "./a.css";' },
      {
        path: 'src/StorefrontApp.tsx',
        content: 'export default function App() { return <main />; }',
      },
    ];
    await expect(compileStorefrontTailwindCss(cyclic)).rejects.toThrow(
      /Cyclic CSS @import/
    );
  });
});
