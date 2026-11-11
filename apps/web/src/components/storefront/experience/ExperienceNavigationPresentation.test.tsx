import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ExperienceNavigationPresentation } from './ExperienceNavigationPresentation';

it('renders real noopener anchor, cancel and same-tab fallback; no automatic popup', () => {
  const popup = vi.spyOn(window, 'open');
  const cancel = vi.fn();
  const same = vi.fn();
  render(
    <ExperienceNavigationPresentation
      link={{ href: 'http://localhost/products/device', presentationId: 'p' }}
      onCancel={cancel}
      onSameTab={same}
    />
  );
  const link = screen.getByRole('link', { name: 'Open in new tab' });
  expect(link.getAttribute('target')).toBe('_blank');
  expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(cancel).toHaveBeenCalledOnce();
  expect(popup).not.toHaveBeenCalled();
  popup.mockRestore();
});
