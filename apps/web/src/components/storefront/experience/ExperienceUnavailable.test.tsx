import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
  usePathname: () => '/qa1',
}));

import { ExperienceUnavailable } from './ExperienceUnavailable';

it('shows a usable retry instead of blank content after a failed published-head read', () => {
  render(<ExperienceUnavailable />);
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Storefront temporarily unavailable'
  );
  fireEvent.click(screen.getByRole('button', { name: 'Refresh storefront' }));
  expect(refresh).toHaveBeenCalledOnce();
});
