import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { previewInertLinkBlocks } from './preview-inert-link-blocks';

describe('preview inert Flex and carousel review surfaces', () => {
  it('renders the accepted Flex children slot through Puck without adding navigation', () => {
    const renderDropZone = vi.fn(({ zone }: { zone: string }) => (
      <p data-testid="preview-flex-child">{zone}</p>
    ));

    render(
      previewInertLinkBlocks.Flex.render({
        puck: { renderDropZone },
      })
    );

    expect(renderDropZone).toHaveBeenCalledWith({ zone: 'children' });
    expect(screen.getByTestId('builder-preview-inert-flex')).toHaveClass(
      'flex',
      'flex-col'
    );
    expect(screen.getByTestId('preview-flex-child')).toHaveTextContent(
      'children'
    );
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('keeps one carousel viewport while making every accepted slide copy reviewable', () => {
    render(
      previewInertLinkBlocks.HeroCarousel.render({
        slides: [
          { ctaText: 'Shop first', title: 'First slide' },
          {
            ctaText: 'Shop second',
            subtitle: 'Second copy',
            title: 'Second slide',
          },
          { ctaText: 'Shop third', title: 'Third slide' },
        ],
      })
    );

    const carousel = screen.getByRole('region', {
      name: 'Preview hero carousel',
    });
    expect(carousel).toHaveClass('h-[60vh]', 'overflow-hidden');
    expect(carousel.querySelectorAll('[data-slide-index]')).toHaveLength(1);
    expect(
      screen.getByRole('heading', { name: 'First slide' })
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('builder-preview-carousel-slides')
    ).toHaveTextContent(
      'Review 3 slidesSecond slideSecond copyShop secondThird slideShop third'
    );
    expect(
      screen.getByTestId('builder-preview-carousel-slides')
    ).toHaveAttribute('open');
    expect(
      screen.getByRole('heading', { name: 'Second slide' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Third slide' })
    ).toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
});
