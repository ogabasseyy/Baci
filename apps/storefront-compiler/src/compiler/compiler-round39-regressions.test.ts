import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-storefront-manifest';
import {
  compileStorefrontWorker,
  StorefrontCompilerError,
} from './compile-storefront';
import { buildFramedAnchorInterceptorSnippet } from './framed-anchor-snippet';

describe('Round 39 async component rejection, createPortal block, and attribute-node write guard', () => {
  it('rejects async/generator entry & JSX components, createPortal escapes, and writes through Element.attributes', async () => {
    const escapes = [
      `export default async function App() { return <main>Async</main>; }`,
      `const App = async () => <main>Async Arrow</main>;\nexport default App;`,
      `async function AsyncCard() { return <p>Card</p>; }\nexport default function App() { return <main><AsyncCard /></main>; }`,
      `import { Component } from 'react';\nexport default class App extends Component { async render() { return <main>Bad</main>; } }`,
      `import { Component } from 'react';\nclass Base extends Component { render() { return <main>Ok</main>; } }\nexport default class App extends Base { async ['render']() { return <main>Bad</main>; } }`,
      `import { createPortal } from 'react-dom';\nexport default function App() { return <main onMouseOut={(e) => { if (e.relatedTarget) createPortal(<a href="/cart">Go</a>, e.relatedTarget as Element); }}>Store</main>; }`,
      `import { useRef } from 'react';\nexport default function App() { const ref = useRef<HTMLAnchorElement>(null); return <a ref={ref} href="/cart" onClick={() => { if (ref.current) ref.current.attributes['href'].value = 'https://evil.example'; }}>Cart</a>; }`,
      `import { useRef } from 'react';\nexport default function App() { const ref = useRef<HTMLAnchorElement>(null); return <a ref={ref} href="/cart" onClick={() => { const attr = ref.current?.attributes[0]; if (attr) attr.value = 'https://evil.example'; }}>Cart</a>; }`,
      `export default function App() { return <a href="/cart" onMouseOver={(e) => { const { attributes: { 0: attr } } = e.currentTarget; attr.value = 'https://evil.example'; }}>Cart</a>; }`,
      `export default function App() { return <a href="/cart" onMouseOver={(e) => { let attr: Attr; ({ attributes: { 0: attr } } = e.currentTarget); attr.value = 'https://evil.example'; }}>Cart</a>; }`,
      `import { useRef } from 'react';\nexport default function App() { const ref = useRef<HTMLAnchorElement>(null); return <a ref={ref} href="/cart" onClick={() => { ref.current?.attributes.getNamedItem('href'); }}>Cart</a>; }`,
    ];

    for (const content of escapes) {
      const m = createOgabasseyStorefrontManifest();
      m.packages = [{ name: 'react-dom', versionRef: 'platform-pinned' }];
      m.files = [{ path: 'src/StorefrontApp.tsx', content }];
      await expect(compileStorefrontWorker(m)).rejects.toThrow(
        StorefrontCompilerError
      );
    }

    // Benign product.attributes read AND TypeScript render() overload signatures still compile cleanly
    const benign = createOgabasseyStorefrontManifest();
    benign.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `import { Component, type ReactNode } from 'react';
class Banner extends Component {
  render(): ReactNode;
  render() { return <h1>Ogabassey</h1>; }
}
export default function App() {
  const item = { attributes: { ram: '16GB' } };
  return <main><Banner />{item.attributes.ram}</main>;
}`,
      },
    ];
    const compiled = await compileStorefrontWorker(benign);
    expect(compiled.workerCode.length).toBeGreaterThan(100);
  });

  it('intercepts clicks both when React stops propagation at #root and when clicks originate on document outside #root', () => {
    const containerListeners: Record<string, Array<(ev: unknown) => void>> = {};
    const docListeners: Record<string, Array<(ev: unknown) => void>> = {};
    const container = {
      addEventListener: (type: string, fn: (ev: unknown) => void) => {
        containerListeners[type] = [...(containerListeners[type] ?? []), fn];
      },
    };
    const doc = {
      baseURI: 'https://ogabassey.usebaci.com/',
      addEventListener: (type: string, fn: (ev: unknown) => void) => {
        docListeners[type] = [...(docListeners[type] ?? []), fn];
      },
    };
    let checkoutOpens = 0;
    const goPaths: string[] = [];
    const commerce = {
      checkout: {
        open: () => {
          checkoutOpens += 1;
        },
      },
      navigation: {
        go: (p: string) => {
          goPaths.push(p);
          return { status: 'ok' };
        },
        open: () => ({ status: 'ok', value: { presented: true } }),
      },
    };
    vm.runInNewContext(
      `${buildFramedAnchorInterceptorSnippet()}\nattachFramedNavigationInterceptors(container, commerce, { merchantSlug: 'ogabassey', pathname: '/' }, () => '/', () => {});`,
      {
        URL,
        WeakSet,
        Promise,
        setTimeout,
        TRUSTED_HOST_ORIGIN: '',
        window: { parent: {} },
        document: doc,
        container,
        commerce,
      }
    );

    // 1. Click inside #root where React calls stopPropagation() on container (never reaches document)
    let rootPrevented = false;
    const rootEvent = {
      type: 'click',
      button: 0,
      defaultPrevented: false,
      preventDefault() {
        rootPrevented = true;
        this.defaultPrevented = true;
      },
      target: {
        tagName: 'A',
        hasAttribute: (n: string) => n === 'href',
        getAttribute: (n: string) => (n === 'href' ? '/checkout' : null),
      },
    };
    for (const fn of containerListeners.click ?? []) fn(rootEvent);
    expect(rootPrevented).toBe(true);
    expect(checkoutOpens).toBe(1);

    // 2. Click outside #root that only bubbles through document
    let docPrevented = false;
    const docEvent = {
      type: 'click',
      button: 0,
      defaultPrevented: false,
      preventDefault() {
        docPrevented = true;
        this.defaultPrevented = true;
      },
      target: {
        tagName: 'A',
        hasAttribute: (n: string) => n === 'href',
        getAttribute: (n: string) => (n === 'href' ? '/smartphones' : null),
      },
    };
    for (const fn of docListeners.click ?? []) fn(docEvent);
    expect(docPrevented).toBe(true);
    expect(goPaths).toEqual(['/smartphones']);
  });
});
