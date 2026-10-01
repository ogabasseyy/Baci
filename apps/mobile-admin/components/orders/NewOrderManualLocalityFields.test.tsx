import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { LIGHT_COLORS } from '@/constants/theme';
import { NewOrderManualLocalityFields } from './NewOrderManualLocalityFields';

vi.mock('react-native', async () => {
  const React = await import('react');
  return {
    Text: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('span', null, children),
    TextInput: ({
      placeholder,
      value,
    }: {
      placeholder?: string;
      value?: string;
    }) =>
      React.createElement('input', {
        placeholder,
        value: value ?? '',
      }),
    View: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
  };
});

vi.mock('./new-order.styles', () => ({ styles: {} }));

describe('NewOrderManualLocalityFields', () => {
  it('renders city and state inputs', () => {
    render(
      <NewOrderManualLocalityFields
        city="Ikeja"
        colors={LIGHT_COLORS}
        onCityChange={vi.fn()}
        onStateChange={vi.fn()}
        state="Lagos"
      />
    );

    expect(screen.getByPlaceholderText('City')).toHaveValue('Ikeja');
    expect(screen.getByPlaceholderText('State')).toHaveValue('Lagos');
  });
});
