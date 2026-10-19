import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { widgetHost } from '../widget-host';
import { useOpenAiGlobal } from './use-openai-global';

afterEach(() => {
  widgetHost.reset();
  delete window.openai;
});

function ThemeProbe() {
  const theme = useOpenAiGlobal('theme');
  return <span data-testid="theme">{theme ?? 'none'}</span>;
}

it('re-reads the native host after the adapter resets', () => {
  window.openai = {};
  render(<ThemeProbe />);
  expect(screen.getByTestId('theme').textContent).toBe('none');
  act(() => {
    widgetHost.update({ theme: 'dark' });
  });
  expect(screen.getByTestId('theme').textContent).toBe('dark');
  act(() => {
    widgetHost.reset();
  });
  expect(screen.getByTestId('theme').textContent).toBe('none');
});
