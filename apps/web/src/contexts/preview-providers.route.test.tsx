import { builderDesignCapabilities } from '@baci/shared/contracts';
import { act, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BuilderPreviewCanvas } from '@/app/(preview)/template-preview/builder-preview/builder-preview-canvas';
import { PreviewProviders } from './preview-providers';

const mocks = vi.hoisted(() => ({
  pathname: '/template-preview/builder-preview',
}));

vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }));
vi.mock('@/components/storefront/render-builder-config', () => ({
  RenderBuilderConfig: ({
    config,
    onRendered,
  }: {
    config: { content: Array<{ props: { id: string } }> };
    onRendered: () => void;
  }) => {
    useEffect(() => onRendered(), [onRendered]);
    return (
      <output data-testid="route-preview-render">
        {config.content[0]?.props.id}
      </output>
    );
  },
}));

const validMessage = {
  candidateConfig: {
    content: [{ props: { id: 'text-1', title: 'Welcome' }, type: 'Text' }],
    root: { props: { title: 'Home' } },
  },
  capabilityHash: builderDesignCapabilities.capabilityHash,
  capabilityVersion: builderDesignCapabilities.capabilityVersion,
  merchant: { id: 'merchant-1', slug: 'acme-store' },
  revision: 1,
  type: 'baci.builder-preview.render',
  version: 1,
};

describe('builder preview provider route boundary', () => {
  afterEach(() => {
    delete (window as Window & { ReactNativeWebView?: unknown })
      .ReactNativeWebView;
    vi.unstubAllGlobals();
  });

  it('keeps actual preview canvas storage- and network-free before and after a candidate', async () => {
    const methods = ['getItem', 'setItem', 'removeItem', 'clear'] as const;
    const localStorageSpies = methods.map((method) =>
      vi.spyOn(window.localStorage, method)
    );
    const sessionStorageSpies = methods.map((method) =>
      vi.spyOn(window.sessionStorage, method)
    );
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    Object.defineProperty(window, 'ReactNativeWebView', {
      configurable: true,
      value: { postMessage: vi.fn() },
    });

    render(
      <PreviewProviders>
        <BuilderPreviewCanvas />
      </PreviewProviders>
    );

    expect(
      screen.queryByTestId('route-preview-render')
    ).not.toBeInTheDocument();
    for (const storageSpy of [...localStorageSpies, ...sessionStorageSpies])
      expect(storageSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();

    act(() =>
      window.dispatchEvent(new MessageEvent('message', { data: validMessage }))
    );

    expect(await screen.findByTestId('route-preview-render')).toHaveTextContent(
      'text-1'
    );
    for (const storageSpy of [...localStorageSpies, ...sessionStorageSpies])
      expect(storageSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    for (const storageSpy of [...localStorageSpies, ...sessionStorageSpies])
      storageSpy.mockRestore();
  });
});
