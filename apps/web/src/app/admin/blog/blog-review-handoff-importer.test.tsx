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
  it('disables selection while saving and invalidates reads even after saving ends', async () => {
    const onImport = vi.fn();
    const { rerender } = render(
      <BlogReviewHandoffImporter onImport={onImport} />
    );
    const pending = Promise.withResolvers<string>();
    const file = new File([], 'pending.json');
    vi.spyOn(file, 'text').mockReturnValue(pending.promise);
    fireEvent.change(screen.getByLabelText('Review handoff JSON'), {
      target: { files: [file] },
    });
    rerender(<BlogReviewHandoffImporter disabled onImport={onImport} />);
    expect(screen.getByLabelText('Review handoff JSON')).toBeDisabled();
    rerender(<BlogReviewHandoffImporter onImport={onImport} />);
    await act(async () => pending.resolve(JSON.stringify(handoff)));
    expect(onImport).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).not.toHaveTextContent('Draft loaded');
  });

  it.each([
    2_000_000, 2_000_001,
  ])('enforces the advertised decimal byte limit at %s bytes', async (size) => {
    const onImport = vi.fn();
    render(<BlogReviewHandoffImporter onImport={onImport} />);
    const file = new File(
      [JSON.stringify(handoff).padEnd(size, ' ')],
      'boundary.json'
    );
    expect(file.size).toBe(size);
    fireEvent.change(screen.getByLabelText('Review handoff JSON'), {
      target: { files: [file] },
    });
    if (size === 2_000_000) {
      await waitFor(() => expect(onImport).toHaveBeenCalledOnce());
    } else {
      expect(screen.getByRole('status')).toHaveTextContent(
        'The review file is larger than 2 MB (2,000,000 bytes).'
      );
      expect(onImport).not.toHaveBeenCalled();
    }
  });

  it.each([
    '{',
    'not JSON',
    '{"title":}',
  ])('shows a friendly message for malformed JSON %s', async (text) => {
    const onImport = vi.fn();
    render(<BlogReviewHandoffImporter onImport={onImport} />);
    fireEvent.change(screen.getByLabelText('Review handoff JSON'), {
      target: { files: [new File([text], 'broken.json')] },
    });
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'This file is not valid JSON.'
      )
    );
    expect(onImport).not.toHaveBeenCalled();
  });

  it('uses the latest import callback when a pending read finishes', async () => {
    const oldImport = vi.fn();
    const latestImport = vi.fn().mockReturnValue(false);
    const { rerender } = render(
      <BlogReviewHandoffImporter onImport={oldImport} />
    );
    const pending = Promise.withResolvers<string>();
    const file = new File([], 'pending.json');
    vi.spyOn(file, 'text').mockReturnValue(pending.promise);
    fireEvent.change(screen.getByLabelText('Review handoff JSON'), {
      target: { files: [file] },
    });
    rerender(<BlogReviewHandoffImporter onImport={latestImport} />);
    await act(async () => pending.resolve(JSON.stringify(handoff)));
    expect(oldImport).not.toHaveBeenCalled();
    expect(latestImport).toHaveBeenCalledOnce();
    expect(screen.getByRole('status')).toHaveTextContent('Import cancelled.');
  });

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

  it('invalidates a pending read when the importer unmounts', async () => {
    const onImport = vi.fn();
    const { unmount } = render(
      <BlogReviewHandoffImporter onImport={onImport} />
    );
    const pending = Promise.withResolvers<string>();
    const file = new File([], 'pending.json');
    vi.spyOn(file, 'text').mockReturnValue(pending.promise);
    fireEvent.change(screen.getByLabelText('Review handoff JSON'), {
      target: { files: [file] },
    });
    unmount();
    await act(async () => pending.resolve(JSON.stringify(handoff)));
    expect(onImport).not.toHaveBeenCalled();
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
