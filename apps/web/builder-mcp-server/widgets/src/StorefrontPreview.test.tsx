import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  catalog,
  home,
  merchant,
} from '../../../tools/builder-preview-spike/fixtures';
import { createPreviewHost } from './mcp-app-bridge';
import { StorefrontPreview } from './StorefrontPreview';

const preview = {
  storefrontId: merchant.id,
  version: `draft:${merchant.id}`,
  pageSlug: 'home',
  projection: { config: home, identity: merchant, catalog, inert: true },
  readiness: { ready: false, missingItems: ['At least one active product'] },
};
describe('private homepage widget', () => {
  it('renders actual inert blocks, labels scope and revision and clears merchant data on reconnect errors', () => {
    const host = createPreviewHost();
    host.result({ structuredContent: preview });
    const { container } = render(<StorefrontPreview host={host} />);
    expect(screen.getByText('Homepage preview')).toBeInTheDocument();
    expect(screen.getByText('Authorized fixture camera')).toBeInTheDocument();
    expect(container.querySelectorAll('a[href]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-baci-block]')).toHaveLength(6);
    act(() =>
      host.result({
        isError: true,
        structuredContent: { code: 'CONNECTION_REVOKED' },
      })
    );
    expect(
      screen.queryByText('Authorized fixture camera')
    ).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Reconnect');
  });
  it('keeps host errors visible and reports new height without ResizeObserver', async () => {
    const host = createPreviewHost();
    const size = vi.fn().mockResolvedValue(undefined);
    host.attach({
      size,
      expand: vi.fn().mockRejectedValue(new Error('denied')),
      open: vi.fn(),
    });
    host.result({ structuredContent: preview });
    const { unmount } = render(<StorefrontPreview host={host} />);
    const before = size.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Expand preview' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not expand'
    );
    expect(size.mock.calls.length).toBeGreaterThan(before);
    unmount();
  });
  it('reports height when a late host connects without ResizeObserver', () => {
    const host = createPreviewHost();
    host.result({ structuredContent: preview });
    render(<StorefrontPreview host={host} />);
    const size = vi.fn().mockResolvedValue(undefined);
    act(() => host.attach({ size, expand: vi.fn(), open: vi.fn() }));
    expect(size).toHaveBeenCalled();
  });
  it('does not render a signed URL smuggled through CSS background tokens', () => {
    const host = createPreviewHost();
    host.result({
      structuredContent: {
        ...preview,
        projection: {
          ...preview.projection,
          config: {
            ...home,
            theme: {
              colors: {
                background:
                  'url(https://example.supabase.co/storage/v1/object/sign/private/a?token=SECRET)',
              },
            },
          },
        },
      },
    });
    const { container } = render(<StorefrontPreview host={host} />);
    expect(screen.getByRole('alert')).toHaveTextContent('unavailable');
    expect(container.innerHTML).not.toContain('SECRET');
  });
  it('rejects cross-tenant and unsafe asset results and clears snapshots during a new tool input', () => {
    const host = createPreviewHost();
    host.result({ structuredContent: preview });
    render(<StorefrontPreview host={host} />);
    act(() => host.waiting());
    expect(
      screen.queryByText('Authorized fixture camera')
    ).not.toBeInTheDocument();
    act(() =>
      host.result({
        structuredContent: {
          ...preview,
          storefrontId: '20000000-0000-4000-8000-000000000002',
        },
      })
    );
    expect(screen.getByRole('alert')).toHaveTextContent('unavailable');
    act(() =>
      host.result({
        structuredContent: {
          ...preview,
          projection: {
            ...preview.projection,
            identity: {
              ...merchant,
              logo_url: 'https://usebaci.com/logo?token=secret',
            },
          },
        },
      })
    );
    expect(
      screen.queryByText('Authorized fixture camera')
    ).not.toBeInTheDocument();
  });
});
