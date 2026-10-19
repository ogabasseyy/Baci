import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ContentLayout from './layout';

describe('content layout', () => {
  it('eagerly styles content routes instead of waiting for first input', () => {
    render(
      <ContentLayout>
        <main>About</main>
      </ContentLayout>
    );

    expect(screen.getByRole('main')).toHaveTextContent('About');
  });
});
