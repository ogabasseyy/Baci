import { describe, expect, it } from 'vitest';
import { parseExperienceManifest } from './experience-manifest';

const fixture = () => ({
  format: 'baci.experience/v2',
  runtime: 'react-browser-sandbox/v1',
  sdkVersion: 'commerce-bridge/v1',
  entry: 'src/Experience.tsx',
  files: [
    {
      path: 'src/Experience.tsx',
      content:
        'export default function Experience(){ const [n,setN]=useState(0); return <button onClick={()=>setN(n+1)}>{n}</button> }',
    },
  ],
  packages: [{ name: 'react', versionRef: 'platform-pinned' }],
  routes: [{ path: '/', view: 'home' }],
  assets: [],
  capabilities: ['catalog.read'],
});

describe('full source manifest', () => {
  it('rejects asset identities that could escape the fixed local asset gateway', () => {
    for (const assetId of [
      '../entry.js',
      'https://private.invalid',
      '%2e%2e/entry.js',
      '/absolute',
    ])
      expect(() =>
        parseExperienceManifest({
          ...fixture(),
          assets: [{ assetId, alt: 'Synthetic' }],
        })
      ).toThrow();
  });
  it('preserves_full_source_and_hooks without a component registry or interaction DSL', () => {
    const input = fixture();
    expect(parseExperienceManifest(input).files).toEqual(input.files);
  });
  it('rejects_over_limit_source_and_path_collision', () => {
    expect(() =>
      parseExperienceManifest({
        ...fixture(),
        files: Array.from({ length: 129 }, (_, i) => ({
          path: `src/${i}.tsx`,
          content: '',
        })),
      })
    ).toThrow();
    expect(() =>
      parseExperienceManifest({
        ...fixture(),
        files: [
          { path: 'src/Experience.tsx', content: 'x'.repeat(512 * 1024 + 1) },
        ],
      })
    ).toThrow();
    expect(() =>
      parseExperienceManifest({
        ...fixture(),
        files: [
          ...Array.from({ length: 8 }, (_, i) => ({
            path: i ? `src/${i}.tsx` : 'src/Experience.tsx',
            content: 'x'.repeat(512 * 1024),
          })),
          { path: 'src/extra.ts', content: 'x' },
        ],
      })
    ).toThrow();
    expect(() =>
      parseExperienceManifest({
        ...fixture(),
        files: [
          ...fixture().files,
          { path: 'SRC/experience.tsx', content: '' },
        ],
      })
    ).toThrow();
  });
  it.each([
    '../escape.ts',
    '/absolute.ts',
    'src/../escape.ts',
    'src\\escape.ts',
    'src/%2e%2e/file.ts',
    'src/file.ts\u0000',
  ])('rejects unsafe source path %s', (path) => {
    expect(() =>
      parseExperienceManifest({
        ...fixture(),
        entry: path,
        files: [{ path, content: '' }],
      })
    ).toThrow();
  });
  it('requires an existing entry, unique route and known capability; rejects authority fields', () => {
    expect(() =>
      parseExperienceManifest({ ...fixture(), entry: 'src/missing.tsx' })
    ).toThrow();
    expect(() =>
      parseExperienceManifest({
        ...fixture(),
        routes: [
          { path: '/', view: 'home' },
          { path: '/', view: 'product' },
        ],
      })
    ).toThrow();
    expect(() =>
      parseExperienceManifest({ ...fixture(), capabilities: ['orders.create'] })
    ).toThrow();
    expect(() =>
      parseExperienceManifest({ ...fixture(), merchantId: 'foreign' })
    ).toThrow();
  });
});
