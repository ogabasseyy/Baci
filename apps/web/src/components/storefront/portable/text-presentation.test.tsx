import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { StorefrontTextPresentation } from './text-presentation';

it.each([
  'left',
  'center',
  'right',
] as const)('renders plain copy and %s alignment', (align) => {
  const { container } = render(
    <StorefrontTextPresentation
      title="About"
      content={'Line one\n<script>plain text</script>'}
      align={align}
    />
  );
  expect(
    screen.getByRole('heading', { name: 'About', level: 2 })
  ).toBeVisible();
  expect(screen.getByText(/Line one/)).toHaveTextContent(
    '<script>plain text</script>'
  );
  expect(container.querySelector('script')).toBeNull();
  expect(container.querySelector('.baci-text')).toHaveStyle({
    textAlign: align,
  });
});
it('omits an empty optional heading', () => {
  render(<StorefrontTextPresentation title="" content="Body" align="left" />);
  expect(screen.queryByRole('heading')).toBeNull();
  expect(screen.getByText('Body')).toBeVisible();
});
