import { act, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { expect, it, vi } from 'vitest';
import { useBottomToolbarSpace } from './use-bottom-toolbar-space';

it('reserves measured toolbar height, bottom inset and content clearance', () => {
  let height = 60;
  const bounds = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(
      () => ({ height, bottom: window.innerHeight - 24 }) as DOMRect
    );
  function Fixture() {
    const { toolbar, bottomSpace } = useBottomToolbarSpace();
    return createElement(
      'div',
      { ref: toolbar },
      createElement('output', null, bottomSpace)
    );
  }
  render(createElement(Fixture));
  expect(screen.getByRole('status')).toHaveTextContent('100');
  height = 80;
  act(() => window.dispatchEvent(new Event('resize')));
  expect(screen.getByRole('status')).toHaveTextContent('120');
  height = 0;
  act(() => window.dispatchEvent(new Event('resize')));
  expect(screen.getByRole('status')).toHaveTextContent('0');
  bounds.mockRestore();
});
