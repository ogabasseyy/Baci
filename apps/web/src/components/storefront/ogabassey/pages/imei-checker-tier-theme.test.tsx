import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ImeiCheckerTierSelector } from './imei-checker-tier-selector';

it('uses storefront colours in expanded comparisons and features', () => {
  render(<ImeiCheckerTierSelector canToggleServices={false} displayedTierKeys={['basic', 'appleBasic']} selectedTier="basic" showAllServices onSelectTier={vi.fn()} onToggleServices={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Compare options for Device details' }));
  const comparison = screen.getByRole('region', { name: 'Compare Device details' });
  expect(comparison.parentElement?.className).toContain('border-[var(--store-border,#e5e7eb)]');
  fireEvent.click(screen.getByRole('button', { name: /what.s included/i }));
  expect(document.querySelector('.bg-gray-100')).toBeNull();
  expect(screen.getAllByRole('listitem')[0].className).toContain('bg-[var(--store-background,#ffffff)]');
});
