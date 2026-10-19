import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { builderDesignCapabilities } from '@baci/shared/contracts';
import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BuilderPreviewCanvas } from './builder-preview-canvas';

vi.mock('@/components/storefront/render-builder-config', () => ({
  RenderBuilderConfig: ({
    config,
    merchantContext,
    onRendered,
  }: {
    config: { content: Array<{ props: { id: string } }> };
    merchantContext: { basePath: string };
    onRendered: () => void;
  }) => {
    if (config.content[0]?.props.id === 'render-failure')
      throw new Error('Preview renderer failed');
    useEffect(() => {
      onRendered();
    }, [onRendered]);
    return (
      <output
        data-base-path={merchantContext.basePath}
        data-testid="builder-preview-render"
      >
        {config.content[0]?.props.id}
      </output>
    );
  },
}));

const validMessage = (revision: number, id = 'text-1') => ({
  candidateConfig: {
    content: [{ props: { id, title: 'Welcome' }, type: 'Text' }],
    root: { props: { title: 'Home' } },
  },
  capabilityHash: builderDesignCapabilities.capabilityHash,
  capabilityVersion: builderDesignCapabilities.capabilityVersion,
  merchant: {
    basePath: '/acme-store',
    id: 'merchant-1',
    slug: 'acme-store',
  },
  revision,
  type: 'baci.builder-preview.render',
  version: 1,
});

function installBridge() {
  const postMessage = vi.fn();
  Object.defineProperty(window, 'ReactNativeWebView', {
    configurable: true,
    value: { postMessage },
  });
  return postMessage;
}

function send(data: unknown, target: Window | Document = window) {
  act(() => target.dispatchEvent(new MessageEvent('message', { data })));
}

describe('BuilderPreviewCanvas', () => {
  afterEach(() => {
    delete (window as Window & { ReactNativeWebView?: unknown })
      .ReactNativeWebView;
  });

  it('announces ready only after mounting and renders no merchant content first', async () => {
    const postMessage = installBridge();
    render(<BuilderPreviewCanvas />);

    expect(
      screen.queryByTestId('builder-preview-render')
    ).not.toBeInTheDocument();
    await waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));
    expect(JSON.parse(postMessage.mock.calls[0][0])).toEqual({
      capabilityHash: builderDesignCapabilities.capabilityHash,
      capabilityVersion: builderDesignCapabilities.capabilityVersion,
      type: 'baci.builder-preview.ready',
      version: 1,
    });
  });

  it('renders only a valid in-memory candidate with its merchant base path', async () => {
    const postMessage = installBridge();
    render(<BuilderPreviewCanvas />);

    send(validMessage(3));

    expect(
      await screen.findByTestId('builder-preview-render')
    ).toHaveTextContent('text-1');
    expect(screen.getByTestId('builder-preview-render')).toHaveAttribute(
      'data-base-path',
      '/acme-store'
    );
    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.stringContaining('"revision":3')
      )
    );
  });

  it('accepts Android document and iOS window string transports before revision gating', async () => {
    installBridge();
    render(<BuilderPreviewCanvas />);

    send(JSON.stringify(validMessage(6, 'android-document')), document);
    expect(await screen.findByText('android-document')).toBeInTheDocument();
    send(JSON.stringify(validMessage(7, 'ios-window')));

    expect(await screen.findByText('ios-window')).toBeInTheDocument();
    send(JSON.stringify(validMessage(6, 'stale-document')), document);
    expect(screen.getByTestId('builder-preview-render')).toHaveTextContent(
      'ios-window'
    );
  });

  it('acknowledges a valid candidate only after its preview renderer commits', async () => {
    const postMessage = installBridge();
    render(<BuilderPreviewCanvas />);
    expect(postMessage).toHaveBeenCalledTimes(1);

    send(validMessage(8));

    expect(
      await screen.findByTestId('builder-preview-render')
    ).toBeInTheDocument();
    await waitFor(() => expect(postMessage).toHaveBeenCalledTimes(2));
    expect(JSON.parse(postMessage.mock.calls[1][0])).toEqual({
      revision: 8,
      type: 'baci.builder-preview.rendered',
      version: 1,
    });
  });

  it('returns a bounded error when the mounted renderer fails', async () => {
    const postMessage = installBridge();
    render(<BuilderPreviewCanvas />);

    send(validMessage(9, 'render-failure'));

    await waitFor(() => expect(postMessage).toHaveBeenCalledTimes(2));
    expect(JSON.parse(postMessage.mock.calls[1][0])).toEqual({
      code: 'render_failed',
      revision: 9,
      type: 'baci.builder-preview.error',
      version: 1,
    });
  });

  it('does not suppress a render failure after a same-revision success response', async () => {
    const postMessage = installBridge();
    render(<BuilderPreviewCanvas />);
    send(validMessage(10));
    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.stringContaining('"type":"baci.builder-preview.rendered"')
      )
    );
    // The response key includes the outcome, so a later boundary failure for
    // this revision remains observable instead of being deduplicated away.
    expect(
      postMessage.mock.calls.some(([value]) =>
        String(value).includes('"revision":10')
      )
    ).toBe(true);
  });

  it('ignores stale and lower revisions after accepting a newer candidate', async () => {
    installBridge();
    render(<BuilderPreviewCanvas />);

    send(validMessage(4, 'newer'));
    expect(await screen.findByText('newer')).toBeInTheDocument();
    send(validMessage(3, 'older'));
    send(validMessage(4, 'stale'));

    expect(screen.getByTestId('builder-preview-render')).toHaveTextContent(
      'newer'
    );
  });

  it('responds to hostile invalid payloads with a bounded error that never echoes the candidate', async () => {
    const postMessage = installBridge();
    render(<BuilderPreviewCanvas />);
    const secret = '<script>merchant-secret</script>';

    send({
      ...validMessage(1),
      candidateConfig: { content: [], root: { props: {} }, secret },
    });

    await waitFor(() => expect(postMessage).toHaveBeenCalledTimes(2));
    const response = JSON.parse(postMessage.mock.calls[1][0]);
    expect(response).toEqual({
      code: 'invalid_message',
      revision: 1,
      type: 'baci.builder-preview.error',
      version: 1,
    });
    expect(JSON.stringify(response)).not.toContain(secret);
    expect(
      screen.queryByTestId('builder-preview-render')
    ).not.toBeInTheDocument();
  });

  it('keeps the cache-components-compatible page metadata-only and noindex', () => {
    const source = readFileSync(resolve(__dirname, 'page.tsx'), 'utf8');

    expect(source).not.toMatch(
      /export const (dynamic|fetchCache|revalidate)\b/
    );
    expect(source).not.toMatch(
      /fetch\(|useMerchant|published_config|page_configs/
    );
    expect(source).toContain('follow: false');
    expect(source).toContain('index: false');
  });

  it('lives beneath the reserved template preview path, never the legacy direct path', () => {
    expect(existsSync(resolve(__dirname, 'page.tsx'))).toBe(true);
    expect(
      existsSync(resolve(__dirname, '../../builder-preview/page.tsx'))
    ).toBe(false);
  });
});
