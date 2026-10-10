// @vitest-environment node
import { renderToString } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { BlogReviewHandoffImporter } from './blog-review-handoff-importer';

it('prerenders the importer without server hook warnings', () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const html = renderToString(
      <BlogReviewHandoffImporter onImport={() => undefined} />
    );
    expect(html).toContain('Import writer review handoff');
    expect(errors).not.toHaveBeenCalled();
  } finally {
    errors.mockRestore();
  }
});
