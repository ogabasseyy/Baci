import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AuthorLayout from './layout';

describe('blog author layout', () => {
  it('eagerly styles author pages instead of waiting for first input', () => {
    render(
      <AuthorLayout>
        <main>Author</main>
      </AuthorLayout>
    );

    expect(screen.getByRole('main')).toHaveTextContent('Author');
  });
});
