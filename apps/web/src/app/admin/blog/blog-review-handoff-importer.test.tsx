import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
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
  it.each([
    'success',
    'failure',
  ] as const)('ignores an older read finishing with %s after a newer import', async (outcome) => {
    const onImport = vi.fn();
    render(<BlogReviewHandoffImporter onImport={onImport} />);
    let resolveRead!: (text: string) => void;
    let rejectRead!: (error: Error) => void;
    const oldFile = new File([''], 'old.json');
    vi.spyOn(oldFile, 'text').mockReturnValue(
      new Promise<string>((resolve, reject) => {
        resolveRead = resolve;
        rejectRead = reject;
      })
    );
    const input = screen.getByLabelText('Review handoff JSON');
    fireEvent.change(input, { target: { files: [oldFile] } });
    fireEvent.change(input, {
      target: {
        files: [
          new File(
            [JSON.stringify({ ...handoff, title: 'Newer draft' })],
            'new.json'
          ),
        ],
      },
    });
    await waitFor(() => expect(onImport).toHaveBeenCalledOnce());
    await act(async () => {
      if (outcome === 'success') resolveRead(JSON.stringify(handoff));
      else rejectRead(new Error('Old read failed'));
    });
    expect(onImport).toHaveBeenCalledOnce();
    expect(onImport).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Newer draft' })
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Draft loaded for review'
    );
  });

  it('invalidates a pending read when the newer file is oversized', async () => {
    const onImport = vi.fn();
    render(<BlogReviewHandoffImporter onImport={onImport} />);
    let resolveRead!: (text: string) => void;
    const oldFile = new File([''], 'old.json');
    vi.spyOn(oldFile, 'text').mockReturnValue(
      new Promise<string>((resolve) => {
        resolveRead = resolve;
      })
    );
    const input = screen.getByLabelText('Review handoff JSON');
    fireEvent.change(input, { target: { files: [oldFile] } });
    fireEvent.change(input, {
      target: { files: [new File(['x'.repeat(2_000_001)], 'large.json')] },
    });
    await act(async () => {
      resolveRead(JSON.stringify(handoff));
    });
    expect(onImport).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('larger than 2 MB');
  });

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
        'An HTTPS featured-image URL is required'
      )
    );
    expect(onImport).not.toHaveBeenCalled();
  });
});
