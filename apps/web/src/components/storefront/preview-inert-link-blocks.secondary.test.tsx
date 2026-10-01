import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PreviewInertFooter } from './preview-inert-footer';
import { previewInertLinkBlocks } from './preview-inert-link-blocks';

describe('previewInertLinkBlocks secondary surfaces', () => {
  it('applies accepted Footer colors and removes an empty navigation landmark', () => {
    const { rerender } = render(
      previewInertLinkBlocks.Footer.render({
        backgroundColor: '#123456',
        quickLinks: [{ label: 'Contact' }],
        quickLinksLabel: 'Explore',
        showQuickLinks: true,
        textColor: '#ffffff',
      })
    );
    expect(screen.getByRole('contentinfo')).toHaveStyle({
      backgroundColor: '#123456',
      color: '#ffffff',
    });
    expect(
      screen.getByRole('navigation', { name: 'Preview footer navigation' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Explore' })
    ).toBeInTheDocument();
    rerender(
      previewInertLinkBlocks.Footer.render({
        backgroundColor: '#123456',
        quickLinks: [],
        showQuickLinks: true,
        textColor: '#ffffff',
      })
    );
    expect(
      screen.queryByRole('navigation', { name: 'Preview footer navigation' })
    ).toBeNull();
  });

  it('uses published theme tokens when Footer colors are omitted', () => {
    const footer = PreviewInertFooter({});
    expect(footer.props.style).toMatchObject({
      backgroundColor: 'var(--theme-footer-bg, #1A202C)',
      color: 'var(--theme-footer-text, #FFFFFF)',
    });
  });

  it('matches the published Footer layout while keeping preview controls inert', () => {
    render(
      previewInertLinkBlocks.Footer.render({
        quickLinks: [{ label: 'Contact' }],
        showNewsletter: true,
        socialLinks: { instagram: 'https://instagram.com/store' },
      })
    );

    const footer = screen.getByRole('contentinfo');
    expect(footer).toHaveClass('mt-auto', 'py-12');
    const container = footer.firstElementChild;
    expect(container).toHaveClass('container', 'mx-auto', 'px-4');
    expect(container?.firstElementChild).toHaveClass(
      'grid',
      'gap-8',
      'sm:grid-cols-2',
      'lg:grid-cols-4'
    );
    expect(
      screen.getByRole('navigation', { name: 'Preview footer navigation' })
        .firstElementChild
    ).toHaveClass('flex', 'flex-col', 'gap-2', 'list-none', 'p-0', 'm-0');
    expect(screen.getByRole('button', { name: 'Contact' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'instagram' })).toBeDisabled();
  });

  it('visibly applies every supported Button align, size, and variant while staying inert', () => {
    const { rerender } = render(
      previewInertLinkBlocks.Button.render({
        align: 'right',
        size: 'lg',
        text: 'Large accent action',
        variant: 'accent',
      })
    );
    const surface = screen.getByTestId('builder-preview-inert-button');
    expect(surface).toHaveAttribute('data-align', 'right');
    expect(surface).toHaveAttribute('data-size', 'lg');
    expect(surface).toHaveAttribute('data-variant', 'accent');
    expect(surface).toHaveClass('justify-end');
    expect(
      screen.getByRole('button', { name: 'Large accent action' })
    ).toHaveClass('bg-store-accent', 'h-10', 'px-6', 'text-store-accent-text');
    rerender(
      previewInertLinkBlocks.Button.render({
        align: 'left',
        size: 'sm',
        text: 'Small background action',
        variant: 'background',
      })
    );
    expect(surface).toHaveClass('justify-start');
    expect(
      screen.getByRole('button', { name: 'Small background action' })
    ).toHaveClass(
      'bg-store-background',
      'h-8',
      'px-3',
      'text-store-background-text'
    );
    rerender(
      previewInertLinkBlocks.Button.render({
        align: 'center',
        size: 'default',
        text: 'Default primary action',
        variant: 'primary',
      })
    );
    expect(surface).toHaveClass('justify-center');
    expect(
      screen.getByRole('button', { name: 'Default primary action' })
    ).toHaveClass('bg-store-primary', 'h-9', 'px-4', 'text-store-primary-text');
  });

  it('renders Footer copyright and only shows local newsletter controls when enabled', () => {
    const fetchSpy = vi.spyOn(window, 'fetch');
    const { rerender } = render(
      previewInertLinkBlocks.Footer.render({
        copyrightText: '© Preview Store 2026',
        showNewsletter: true,
      })
    );
    expect(screen.getByRole('contentinfo')).toHaveTextContent(
      '© Preview Store 2026'
    );
    expect(
      screen.getByRole('heading', { name: 'Newsletter' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('textbox', { name: 'Email address for newsletter' })
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Subscribe' })).toBeDisabled();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    rerender(
      previewInertLinkBlocks.Footer.render({
        copyrightText: '© Updated preview copyright',
        showNewsletter: false,
      })
    );
    expect(screen.getByRole('contentinfo')).toHaveTextContent(
      '© Updated preview copyright'
    );
    expect(screen.queryByRole('heading', { name: 'Newsletter' })).toBeNull();
    expect(
      screen.queryByRole('textbox', { name: 'Email address for newsletter' })
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Subscribe' })).toBeNull();
    fetchSpy.mockRestore();
  });
});
