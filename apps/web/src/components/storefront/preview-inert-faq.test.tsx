import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PreviewInertFAQ } from './preview-inert-faq';

describe('PreviewInertFAQ', () => {
  it('matches published FAQ structure while keeping accordion answers open', () => {
    render(
      <PreviewInertFAQ
        items={[
          { answer: 'Within three days.', question: 'When do you ship?' },
        ]}
        subtitle="We'll help."
        title="Questions"
      />
    );

    const section = screen.getByRole('region', { name: 'Preview FAQ' });
    expect(section).toHaveClass('py-12', 'md:py-16', 'container', 'px-4');
    expect(
      screen.getByRole('heading', { name: 'Questions' }).parentElement
    ).toHaveClass('max-w-3xl', 'mx-auto', 'text-center', 'mb-10');
    const details = screen.getByText('When do you ship?').closest('details');
    expect(details).toHaveAttribute('open');
    expect(details).toHaveClass('group', 'border', 'rounded-lg');
    expect(details?.querySelector('summary')).toHaveClass(
      'flex',
      'justify-between',
      'p-4',
      'font-medium'
    );
    expect(details?.lastElementChild).toHaveClass(
      'p-4',
      'pt-0',
      'text-muted-foreground'
    );
  });

  it('uses the published grid and list surfaces', () => {
    const { rerender } = render(
      <PreviewInertFAQ
        items={[{ answer: 'Answer', question: 'Question' }]}
        style="grid"
      />
    );

    expect(screen.getByText('Question').closest('article')).toHaveClass(
      'p-6',
      'border',
      'rounded-lg',
      'bg-card'
    );
    rerender(
      <PreviewInertFAQ
        items={[{ answer: 'Answer', question: 'Question' }]}
        style="list"
      />
    );
    expect(screen.getByText('Question').closest('article')).toHaveClass(
      'border-b',
      'pb-6',
      'last:border-0'
    );
  });
});
