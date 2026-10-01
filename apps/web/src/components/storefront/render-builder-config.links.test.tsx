import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RenderBuilderConfig } from './render-builder-config';

vi.mock('@puckeditor/core', () => ({
  Render: ({
    config,
    data,
  }: {
    config: {
      components: Record<
        string,
        {
          defaultProps?: Record<string, unknown>;
          render?: (props: Record<string, unknown>) => React.ReactNode;
        }
      >;
    };
    data: { content: Array<{ props: Record<string, unknown>; type: string }> };
  }) =>
    data.content.map((block) => {
      const component = config.components[block.type];
      const props = { ...component?.defaultProps, ...block.props };
      return component?.render ? (
        <div key={block.type}>{component.render(props)}</div>
      ) : (
        <a href={`/merchant/${block.type}`} key={block.type}>
          {block.type}
        </a>
      );
    }),
}));

vi.mock('@/components/builder/config', () => ({
  builderConfig: {
    components: {
      Header: {
        defaultProps: {
          showCart: true,
          showLogo: true,
          showMenu: true,
          showSearch: true,
          sticky: true,
        },
      },
    },
  },
}));

const merchantContext = {
  basePath: '/acme-store',
  id: 'preview-merchant-1',
  slug: 'acme-store',
};

describe('RenderBuilderConfig preview links', () => {
  it('preserves production Header defaults when saved props omit them', () => {
    render(
      <RenderBuilderConfig
        config={{
          content: [
            {
              props: { id: 'Header-1', storeName: 'Preview Store' },
              type: 'Header',
            },
          ],
          root: { props: { title: 'Home' } },
        }}
        merchantContext={merchantContext}
      />
    );

    const header = screen.getByTestId('builder-preview-inert-header');
    expect(header).toHaveAttribute('data-sticky', 'true');
    const searchButtons = screen.getAllByRole('button', { name: 'Search' });
    expect(searchButtons).toHaveLength(2);
    for (const searchButton of searchButtons) {
      expect(searchButton).toBeDisabled();
    }
    expect(screen.getByRole('button', { name: 'Cart' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Menu' })).toBeDisabled();
  });

  it('projects a bounded merchant identity when Header branding props are omitted', () => {
    render(
      <RenderBuilderConfig
        config={{
          content: [{ props: { id: 'Header-1' }, type: 'Header' }],
          root: { props: { title: 'Home' } },
        }}
        merchantContext={{
          basePath: '/north-star-co',
          id: 'preview-merchant-2',
          slug: 'north-star-co',
        }}
      />
    );

    expect(screen.getByText('North Star Co')).toBeInTheDocument();
    expect(
      screen.getByLabelText('North Star Co preview logo')
    ).toBeInTheDocument();
    expect(screen.queryByText('Preview Store')).toBeNull();
  });

  it('uses inert preview renderers so accepted link blocks cannot prefetch or navigate', () => {
    const fetchSpy = vi.spyOn(window, 'fetch');
    render(
      <RenderBuilderConfig
        config={{
          content: [
            {
              props: {
                ctaLink: '/products',
                ctaText: 'Hero action',
                id: 'Hero-1',
                title: 'Hero',
              },
              type: 'Hero',
            },
            {
              props: {
                id: 'HeroCarousel-1',
                slides: [
                  {
                    ctaLink: '/sale',
                    ctaText: 'Carousel action',
                    image: '/placeholder.png',
                    subtitle: 'Preview copy',
                    title: 'Carousel',
                  },
                ],
              },
              type: 'HeroCarousel',
            },
            {
              props: { id: 'Button-1', link: '/products', text: 'Button' },
              type: 'Button',
            },
            {
              props: {
                ctaButton: { show: true, text: 'Header action', url: '/shop' },
                id: 'Header-1',
                navigationLinks: [{ label: 'Shop', url: '/products' }],
                storeName: 'Preview Store',
              },
              type: 'Header',
            },
            {
              props: {
                id: 'Footer-1',
                quickLinks: [{ label: 'Contact', url: '/contact' }],
                showQuickLinks: true,
              },
              type: 'Footer',
            },
          ],
          root: { props: { title: 'Home' } },
        }}
        merchantContext={merchantContext}
      />
    );

    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Hero action' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Carousel action' })
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Button' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Header action' })
    ).toBeDisabled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
