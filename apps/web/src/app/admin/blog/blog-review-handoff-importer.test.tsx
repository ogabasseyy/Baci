import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BlogReviewHandoffImporter } from './blog-review-handoff-importer';

const handoff = {
  schema_version: 'baci-blog-review-handoff/v1',
  status: 'published',
  title: 'A practical Galaxy A guide',
  content_html: '<p>Compare the current models.</p>',
  excerpt: 'A practical comparison.',
  category: 'Smartphones',
  seo_title: 'A practical Galaxy A guide',
  seo_description: 'Compare current Galaxy A phones.',
  tags: ['Samsung'],
  featured_image: {
    url: 'https://cdn.example.com/galaxy-a.webp',
    alt: 'Galaxy A phones',
  },
};

describe('BlogReviewHandoffImporter', () => {
  it('loads a completed handoff into the editor as an unsaved draft', async () => {
    const onImport = vi.fn();
    render(<BlogReviewHandoffImporter onImport={onImport} />);

    fireEvent.change(screen.getByLabelText('Review handoff JSON'), {
      target: {
        files: [new File([JSON.stringify(handoff)], 'review-handoff.json')],
      },
    });

    await waitFor(() => expect(onImport).toHaveBeenCalledOnce());
    expect(onImport).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'draft', title: handoff.title })
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'It has not been saved or published.'
    );
  });

  it('shows validation failures without loading unready content', async () => {
    const onImport = vi.fn();
    render(<BlogReviewHandoffImporter onImport={onImport} />);

    fireEvent.change(screen.getByLabelText('Review handoff JSON'), {
      target: {
        files: [
          new File(
            [
              JSON.stringify({
                ...handoff,
                featured_image: { path: 'cover.png' },
              }),
            ],
            'incomplete.json'
          ),
        ],
      },
    });

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'A public featured-image URL is required'
      )
    );
    expect(onImport).not.toHaveBeenCalled();
  });
});
