import { describe, expect, it } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-storefront-manifest';
import {
  compileStorefrontWorker,
  StorefrontCompilerError,
} from './compile-storefront';

describe('Round 37 destructured Location / History / Navigation / Window alias regressions', () => {
  it('rejects destructured location, history, opener, non-SDK navigation, and 1-arg .replace() escapes while keeping SDK navigation and String.replace()', async () => {
    const escapes = [
      `export default function X() { return <button type="button" onClick={(e) => { const { location } = e.nativeEvent.view as any; location.replace('https://evil.example'); }}>x</button>; }`,
      `export default function X() { return <button type="button" onClick={(e) => { const { location: loc } = e.nativeEvent.view as any; void loc; }}>x</button>; }`,
      `export default function X() { return <button type="button" onClick={(e) => { const { history } = e.nativeEvent.view as any; history.pushState({}, '', '/evil'); }}>x</button>; }`,
      `export default function X() { return <button type="button" onClick={(e) => { const { opener } = e.nativeEvent.view as any; void opener; }}>x</button>; }`,
      `export default function X() { return <button type="button" onClick={(e) => { const { navigation } = e.nativeEvent.view as any; navigation.navigate('https://evil.example'); }}>x</button>; }`,
      `export default function X() { return <button type="button" onClick={(e) => { const { document: doc } = e.nativeEvent.view as any; void doc; }}>x</button>; }`,
      `export default function X() { return <button type="button" onClick={(e) => { const { navigator: nav } = e.nativeEvent.view as any; void nav; }}>x</button>; }`,
      `export default function X() { return <button type="button" onClick={(a: any) => { a[0].replace('https://evil.example'); }}>x</button>; }`,
      `export default function X() { return <button type="button" onClick={(e) => { let open: any; ({ open } = e.nativeEvent.view as any); void open; }}>x</button>; }`,
      `export default function X() { return <button type="button" onClick={(e) => { let loc: any; ({ location: loc } = e.nativeEvent.view as any); void loc; }}>x</button>; }`,
    ];

    for (const content of escapes) {
      const bad = createOgabasseyStorefrontManifest();
      bad.files = [{ path: 'src/StorefrontApp.tsx', content }];
      await expect(compileStorefrontWorker(bad)).rejects.toThrow(
        StorefrontCompilerError
      );
    }

    const valid = createOgabasseyStorefrontManifest();
    valid.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `import { useCommerce } from '@baci/experience-sdk';
type NavHandler = ({ navigation }: { navigation: string }) => void;
export default function App(props: { products: Array<{ name: string; variants: Array<{ storage?: string }> }> }) {
  const commerce = useCommerce();
  const { navigation } = commerce;
  const storeAddress = { location: 'Lagos' };
  const cleanTitle = (props.products[0]?.name ?? 'Device').replace('-', ' ');
  const { storage } = props.products[0]?.variants[0] ?? { storage: '256GB' };
  const noop: NavHandler = () => {};
  void noop;
  return <main><button type="button" onClick={() => { void navigation.go('/search'); void commerce['navigation'].open('/search'); }}>{cleanTitle} {storage} {storeAddress.name}</button></main>;
}`,
      },
    ];
    const compiled = await compileStorefrontWorker(valid);
    expect(compiled.workerCode.length).toBeGreaterThan(100);
  });
});
