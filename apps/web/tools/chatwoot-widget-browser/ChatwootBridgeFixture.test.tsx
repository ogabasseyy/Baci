// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChatwootInlineCartBridge } from './ChatwootBridgeFixture';

describe('ChatwootBridgeFixture', () => {
  it('renders the active bridge store slug', () => {
    render(
      <ChatwootInlineCartBridge
        storeSlug="synthetic-tenant-a"
        widgetOrigin="https://localhost:43129"
      />
    );

    expect(screen.getByTestId('bridge-tenant').textContent).toBe(
      'synthetic-tenant-a'
    );
  });
});
