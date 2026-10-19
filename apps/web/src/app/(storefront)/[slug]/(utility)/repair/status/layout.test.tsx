import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import RepairStatusLayout from './layout';

describe('repair status layout', () => {
  it('eagerly styles repair status instead of waiting for first input', () => {
    render(
      <RepairStatusLayout>
        <main>Status</main>
      </RepairStatusLayout>
    );

    expect(screen.getByRole('main')).toHaveTextContent('Status');
  });
});
