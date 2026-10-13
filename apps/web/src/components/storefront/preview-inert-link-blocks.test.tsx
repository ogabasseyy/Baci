import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { previewInertLinkBlocks } from './preview-inert-link-blocks';

class IntersectionObserverStub {
  disconnect() {}
  observe() {}
  unobserve() {}
}

vi.stubGlobal('IntersectionObserver', IntersectionObserverStub);

describe('previewInertLinkBlocks', () => {
  it('renders all accepted link-bearing blocks without anchors or network activity', () => {
    const fetchSpy = vi.spyOn(window, 'fetch');
    render(
      <>
        {previewInertLinkBlocks.Hero.render({
          ctaText: 'Shop hero',
          subtitle: 'Preview copy',
          title: 'Hero',
        })}
        {previewInertLinkBlocks.HeroCarousel.render({
          slides: [{ ctaText: 'Shop carousel', title: 'Carousel' }],
        })}
        {previewInertLinkBlocks.Button.render({ text: 'Shop button' })}
        {previewInertLinkBlocks.Header.render({
          navigationLinks: [{ label: 'Shop', url: '/products' }],
          storeName: 'Preview Store',
        })}
        {previewInertLinkBlocks.Footer.render({
          quickLinks: [{ label: 'Contact' }],
          showQuickLinks: true,
        })}
      </>
    );

    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Shop hero' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Shop carousel' })
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Shop button' })).toBeDisabled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('returns the stateful Header as a React element for registry consumers', () => {
    expect(() =>
      previewInertLinkBlocks.Header.render({ glassEffect: true, sticky: true })
    ).not.toThrow();
  });

  it('matches the published mobile HeroCarousel viewport and theme tokens', () => {
    const fetchSpy = vi.spyOn(window, 'fetch');
    render(
      previewInertLinkBlocks.HeroCarousel.render({
        slides: [
          {
            ctaText: 'First action',
            image: '/preview-hero.webp',
            title: 'First slide',
          },
          {
            ctaText: 'Edited second action',
            subtitle: 'Latest preview copy',
            title: 'Edited second slide',
          },
        ],
      })
    );

    const carousel = screen.getByRole('region', {
      name: 'Preview hero carousel',
    });
    expect(carousel).toHaveClass('h-[60vh]', 'overflow-hidden');
    expect(carousel).toHaveAttribute('data-slide-count', '2');
    expect(carousel).toHaveAttribute('data-active-slide-index', '0');
    const activeSlide = screen
      .getByRole('region', { name: 'Preview hero carousel' })
      .querySelector('[data-slide-index]');
    expect(activeSlide).toHaveClass(
      'justify-center',
      'text-store-primary-text'
    );
    expect(activeSlide?.className).not.toMatch(/\btext-white\b/);
    expect(carousel.querySelector('[aria-hidden="true"]')).toHaveClass(
      'from-store-foreground/90',
      'via-store-foreground/40'
    );
    expect(
      carousel.querySelector('[aria-hidden="true"]')?.className
    ).not.toMatch(/\b(?:from|via)-black\//);
    expect(
      screen.getByRole('heading', { name: 'First slide' })
    ).toBeInTheDocument();
    expect(carousel.querySelectorAll('[data-slide-index]')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'First action' })).toBeDisabled();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('preserves bounded Hero heading, alignment, and padding in the preview', () => {
    render(
      previewInertLinkBlocks.Hero.render({
        align: 'right',
        headingLevel: 'h2',
        padding: 'large',
        title: 'Catalog preview',
      })
    );

    const hero = screen.getByRole('heading', { level: 2 });
    expect(hero).toHaveTextContent('Catalog preview');
    expect(hero.closest('section')).toHaveClass('text-right', 'py-32');
  });

  it('keeps FAQ accordion answers visible because preview interaction is inert', () => {
    render(
      previewInertLinkBlocks.FAQ.render({
        items: [{ answer: 'Ships in 3 days.', question: 'When does it ship?' }],
        title: 'Questions',
      })
    );

    expect(screen.getByText('When does it ship?')).toBeInTheDocument();
    expect(
      screen.getByText('When does it ship?').closest('details')
    ).toHaveAttribute('open');
    expect(screen.getByText('Ships in 3 days.')).toBeVisible();
  });

  it('uses disabled themed buttons for standalone and carousel actions', () => {
    render(
      <>
        {previewInertLinkBlocks.Button.render({
          text: 'Shop collection',
          variant: 'accent',
        })}
        {previewInertLinkBlocks.HeroCarousel.render({
          slides: [{ ctaText: 'Shop carousel', title: 'Carousel' }],
        })}
      </>
    );

    expect(screen.getByRole('button', { name: 'Shop collection' })).toHaveClass(
      'bg-store-accent',
      'text-store-accent-text'
    );
    expect(screen.getByRole('button', { name: 'Shop carousel' })).toHaveClass(
      'bg-store-primary',
      'text-store-primary-text',
      'h-12'
    );
    expect(
      screen.getByRole('button', { name: 'Shop collection' })
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Shop carousel' })
    ).toBeDisabled();
  });

  it('reflects Header padding, Hero media/overlay, and FAQ style changes', () => {
    render(
      <>
        {previewInertLinkBlocks.Header.render({ paddingY: 'lg' })}
        {previewInertLinkBlocks.Hero.render({
          backgroundImage: '/hero.webp',
          overlay: true,
          title: 'Hero',
        })}
        {previewInertLinkBlocks.FAQ.render({
          items: [{ answer: 'Answer', question: 'Question' }],
          style: 'grid',
        })}
      </>
    );
    expect(screen.getByTestId('builder-preview-inert-header')).toHaveClass(
      'py-6'
    );
    expect(screen.getByRole('region', { name: 'Preview hero' })).toHaveClass(
      'text-store-background'
    );
    expect(
      screen.getByTestId('builder-preview-hero-overlay')
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Preview hero' })).toHaveStyle({
      backgroundImage: 'url(/hero.webp)',
    });
    expect(
      screen
        .getByRole('region', { name: 'Preview FAQ' })
        .querySelector('[data-style]')
    ).toHaveAttribute('data-style', 'grid');
  });

  it('matches published Hero overlay opacity with store theme colors', () => {
    const { rerender } = render(
      previewInertLinkBlocks.Hero.render({
        backgroundImage: '/hero.webp',
        overlay: true,
        title: 'Image hero',
      })
    );

    const overlay = screen.getByTestId('builder-preview-hero-overlay');
    expect(overlay).toHaveClass('bg-store-foreground/40');
    expect(overlay.className).not.toMatch(/\bbg-black\//);

    rerender(
      previewInertLinkBlocks.Hero.render({
        backgroundGradient: 'linear-gradient(#123456, #654321)',
        title: 'Gradient hero',
      })
    );

    expect(screen.getByTestId('builder-preview-hero-overlay')).toHaveClass(
      'bg-store-foreground/60'
    );
  });

  it('preserves FAQ animation settings through the inert animation wrapper', () => {
    render(
      previewInertLinkBlocks.FAQ.render({
        animationDelay: 1,
        animationDuration: 'slow',
        animationTrigger: 'onload',
        animationType: 'fade-in',
        items: [{ answer: 'Answer', question: 'Question' }],
        title: 'Animated FAQ',
      })
    );

    expect(screen.getByRole('region', { name: 'Preview FAQ' })).toMatchObject({
      dataset: {
        animationDelay: '1',
        animationDuration: 'slow',
        animationTrigger: 'onload',
        animationType: 'fade-in',
      },
    });
  });

  it('does not apply a Hero overlay without a background image', () => {
    render(
      previewInertLinkBlocks.Hero.render({ overlay: true, title: 'Plain hero' })
    );

    expect(
      screen.getByRole('region', { name: 'Preview hero' })
    ).not.toHaveClass('text-store-background');
    expect(screen.queryByTestId('builder-preview-hero-overlay')).toBeNull();
  });
});
