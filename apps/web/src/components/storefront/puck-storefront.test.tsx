import { render, screen, waitFor } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getContrastRatio, hexToHslComponents } from '@/lib/color-utils';
import { buildCuratedStorefront } from '@/lib/storefront-defaults/build-curated-storefront';
import { deriveCuratedTheme } from '@/lib/storefront-defaults/derive-curated-theme';
import { PuckStorefront } from './puck-storefront';

const mocks = vi.hoisted(() => ({
  config: null as ReturnType<typeof buildCuratedStorefront> | null,
  merchantId: 'merchant-1' as string | null,
  single: vi.fn(),
}));

vi.mock('@puckeditor/core', () => ({
  Render: ({ data }: { data: ReturnType<typeof buildCuratedStorefront> }) => {
    const header = data.content.find((block) => block.type === 'Header');
    if (header?.type !== 'Header') return null;
    return (
      <>
        <output
          data-background={header.props.backgroundColor}
          data-store-name={header.props.storeName}
          data-text={header.props.textColor}
        />
        <button className="text-destructive" type="button">
          Sign out
        </button>
        {createPortal(
          <button className="text-destructive" type="button">
            Portal sign out
          </button>,
          document.body
        )}
      </>
    );
  },
}));

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchant: () =>
    mocks.merchantId
      ? { merchant: { id: mocks.merchantId } }
      : { merchant: null },
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: mocks.single,
          }),
        }),
      }),
    }),
  }),
}));

function resolveThemeVariable(element: Element, value: string): string {
  const variable = value.match(/^var\((--[^)]+)\)$/)?.[1];
  if (!variable) return value;
  let current: Element | null = element;
  while (current) {
    const resolved = (current as HTMLElement).style
      .getPropertyValue(variable)
      .trim();
    if (resolved) return resolved;
    current = current.parentElement;
  }
  return document.documentElement.style.getPropertyValue(variable).trim();
}

const rootToken = (name: string) =>
  document.documentElement.style.getPropertyValue(name);
function createDeferred<T>() {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  if (!resolve) throw new Error('Deferred resolver was not initialized');
  return { promise, resolve };
}

describe('PuckStorefront', () => {
  beforeEach(() => {
    mocks.merchantId = 'merchant-1';
    mocks.single.mockReset();
    mocks.single.mockImplementation(async () => ({
      data: { published_config: mocks.config },
    }));
    document.documentElement.removeAttribute('style');
    document.documentElement.style.setProperty('--background', 'host-token');
    document.documentElement.style.setProperty('--destructive', 'host-token');
  });

  it.each([
    ['light', '#000000', '#ffffff', '#777777'],
    ['dark', '#ffffff', '#000000', '#777777'],
    ['boundary', '#777777', '#777777', '#ffffff'],
    ['threshold', '#757575', '#757575', '#ffffff'],
  ])('resolves generated Header colors in the public Puck theme scope for %s', async (_name, primary, background, accent) => {
    const theme = deriveCuratedTheme({ primary, background, accent });
    mocks.config = buildCuratedStorefront({
      brandColors: { primary, background, accent },
      businessName: 'North Star',
      businessType: 'fashion',
      country: 'Nigeria',
    });

    render(<PuckStorefront />);

    const renderedHeader = await screen.findByRole('status');
    await waitFor(() =>
      expect(
        resolveThemeVariable(
          renderedHeader,
          renderedHeader.dataset.background ?? ''
        )
      ).toBe(theme.colors.header.background)
    );
    const backgroundValue = resolveThemeVariable(
      renderedHeader,
      renderedHeader.dataset.background ?? ''
    );
    const textValue = resolveThemeVariable(
      renderedHeader,
      renderedHeader.dataset.text ?? ''
    );
    const publicScope = renderedHeader.parentElement;
    if (!publicScope) throw new Error('Public Puck theme scope is required');
    expect(textValue).toBe(theme.colors.header.text);
    expect(publicScope).toHaveStyle({
      '--background': hexToHslComponents(theme.colors.background),
      '--foreground': hexToHslComponents(theme.colors.foreground),
      '--store-background': theme.colors.background,
      '--store-background-text': theme.colors.foreground,
      '--destructive': hexToHslComponents('#B91C1C'),
      '--destructive-foreground': hexToHslComponents('#FFFFFF'),
    });
    expect(getContrastRatio(textValue, backgroundValue)).toBeGreaterThanOrEqual(
      4.5
    );
    expect(screen.getByRole('button', { name: 'Sign out' })).toHaveClass(
      'text-destructive'
    );
    expect(getContrastRatio('#B91C1C', '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ['light', '#000000', '#ffffff', '#777777'],
    ['dark', '#ffffff', '#000000', '#777777'],
    ['boundary', '#777777', '#777777', '#ffffff'],
    ['threshold', '#757575', '#757575', '#ffffff'],
  ])('projects public destructive tokens into an escaped portal for %s', async (_name, primary, background, accent) => {
    mocks.config = buildCuratedStorefront({
      brandColors: { primary, background, accent },
      businessName: 'North Star',
      businessType: 'fashion',
      country: 'Nigeria',
    });

    render(<PuckStorefront />);

    await screen.findByRole('button', {
      name: 'Portal sign out',
    });
    await waitFor(() =>
      expect(rootToken('--destructive')).toBe(hexToHslComponents('#B91C1C'))
    );
    expect(getContrastRatio('#B91C1C', '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
  });

  it('clears prior tenant content and portal tokens when the merchant disappears', async () => {
    const theme = deriveCuratedTheme({
      primary: '#ffffff',
      background: '#000000',
      accent: '#777777',
    });
    mocks.config = buildCuratedStorefront({
      brandColors: {
        primary: '#ffffff',
        background: '#000000',
        accent: '#777777',
      },
      businessName: 'North Star',
      businessType: 'fashion',
      country: 'Nigeria',
    });
    const { rerender } = render(<PuckStorefront />);

    await screen.findByRole('status');
    await waitFor(() =>
      expect(rootToken('--background')).toBe(
        hexToHslComponents(theme.colors.background)
      )
    );

    mocks.merchantId = null;
    rerender(<PuckStorefront />);

    await waitFor(() =>
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    );
    expect(
      document.documentElement.style.getPropertyValue('--background')
    ).toBe('host-token');
  });

  it('ignores a stale tenant load and stale no-config callback after the merchant switches', async () => {
    const firstLoad = createDeferred<{
      error: { code: string };
      data: null;
    }>();
    const secondLoad = createDeferred<{
      data: { published_config: ReturnType<typeof buildCuratedStorefront> };
    }>();
    mocks.single.mockImplementationOnce(() => firstLoad.promise);
    mocks.single.mockImplementationOnce(() => secondLoad.promise);
    mocks.config = buildCuratedStorefront({
      brandColors: {
        primary: '#ffffff',
        background: '#000000',
        accent: '#777777',
      },
      businessName: 'Second Store',
      businessType: 'fashion',
      country: 'Nigeria',
    });
    const onNoConfig = vi.fn();
    const { rerender } = render(<PuckStorefront onNoConfig={onNoConfig} />);

    await waitFor(() => expect(mocks.single).toHaveBeenCalledTimes(1));
    mocks.merchantId = 'merchant-2';
    rerender(<PuckStorefront onNoConfig={onNoConfig} />);
    await waitFor(() => expect(mocks.single).toHaveBeenCalledTimes(2));
    secondLoad.resolve({ data: { published_config: mocks.config } });

    const currentStore = await screen.findByRole('status');
    expect(currentStore).toHaveAttribute('data-store-name', 'Second Store');
    firstLoad.resolve({ data: null, error: { code: 'PGRST116' } });

    await waitFor(() => expect(onNoConfig).not.toHaveBeenCalled());
    expect(screen.getByRole('status')).toHaveAttribute(
      'data-store-name',
      'Second Store'
    );
  });

  it('replaces and cleans the portal lease across a merchant theme change and unmount', async () => {
    mocks.config = buildCuratedStorefront({
      brandColors: {
        primary: '#000000',
        background: '#ffffff',
        accent: '#777777',
      },
      businessName: 'First Store',
      businessType: 'fashion',
      country: 'Nigeria',
    });
    const { rerender, unmount } = render(<PuckStorefront />);

    await screen.findByRole('status');
    await waitFor(() =>
      expect(
        document.documentElement.style.getPropertyValue('--background')
      ).toBe('0 0% 100%')
    );

    mocks.config = buildCuratedStorefront({
      brandColors: {
        primary: '#ffffff',
        background: '#000000',
        accent: '#777777',
      },
      businessName: 'Second Store',
      businessType: 'fashion',
      country: 'Nigeria',
    });
    mocks.merchantId = 'merchant-2';
    rerender(<PuckStorefront />);

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveAttribute(
        'data-store-name',
        'Second Store'
      )
    );
    await waitFor(() =>
      expect(
        document.documentElement.style.getPropertyValue('--background')
      ).toBe('0 0% 0%')
    );

    unmount();

    expect(
      document.documentElement.style.getPropertyValue('--background')
    ).toBe('host-token');
  });
});
