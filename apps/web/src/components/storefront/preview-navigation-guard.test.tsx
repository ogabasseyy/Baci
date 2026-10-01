import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PreviewNavigationGuard } from './preview-navigation-guard';

describe('PreviewNavigationGuard', () => {
  it('prevents Hero, Button, Header, and Footer links from leaving the preview', () => {
    render(
      <PreviewNavigationGuard>
        <a href="/acme-store/products" id="Hero">
          Hero
        </a>
        <a href="/acme-store/cart" id="Button">
          Button
        </a>
        <a href="/acme-store/collections" id="Header">
          Header
        </a>
        <a href="/acme-store/contact" id="Footer">
          Footer
        </a>
      </PreviewNavigationGuard>
    );

    for (const name of ['Hero', 'Button', 'Header', 'Footer']) {
      expect(fireEvent.click(screen.getByRole('link', { name }))).toBe(false);
    }
    expect(
      screen.getByTestId('builder-preview-navigation-guard')
    ).toHaveAttribute('inert');
  });
});
