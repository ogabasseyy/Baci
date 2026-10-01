import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { OgabasseyHomeCriticalShell } from './ogabassey-home-critical-shell';

it('provides critical styles without a duplicate banner or unvalidated product content', () => {
  const { container } = render(<OgabasseyHomeCriticalShell />);
  expect(container.querySelectorAll('style')).toHaveLength(3);
  expect(container.querySelector('h1')).toHaveClass('sr-only');
  expect(
    container.querySelector('img, a, button, .ogabassey-home-lcp-panel')
  ).toBeNull();
});
