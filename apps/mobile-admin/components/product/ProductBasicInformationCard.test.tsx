import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', async () => {
  const React = await import('react');

  return {
    StatusBar: () => null,
    Pressable: ({
      accessibilityLabel,
      children,
      onPress,
    }: {
      accessibilityLabel?: string;
      children?: React.ReactNode;
      onPress?: () => void;
    }) =>
      React.createElement(
        'button',
        { 'aria-label': accessibilityLabel, onClick: () => onPress?.() },
        children
      ),
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
    },
    Text: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('span', null, children),
    TextInput: ({
      onChangeText,
      placeholder,
      value,
    }: {
      onChangeText?: (text: string) => void;
      placeholder?: string;
      value?: string;
    }) =>
      React.createElement('input', {
        value: value ?? '',
        placeholder,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          onChangeText?.(event.target.value),
      }),
    View: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
  };
});

vi.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: () => null,

  default: () => null,
  __esModule: true,
}));

vi.mock('./ExistingProductSuggestions', () => ({
  ExistingProductSuggestions: () => null,
}));

import { ProductBasicInformationCard } from './ProductBasicInformationCard';

describe('ProductBasicInformationCard', () => {
  const colors = {
    accent: '#3b82f6',
    accentLight: 'rgba(59, 130, 246, 0.1)',
    backdrop: 'rgba(15, 23, 42, 0.35)',
    background: '#F8FAFC',
    backgroundLight: '#FFFFFF',
    border: '#E2E8F0',
    card: '#FFFFFF',
    cardHover: '#F1F5F9',
    error: '#DC2626',
    errorLight: 'rgba(220, 38, 38, 0.1)',
    gold: '#D4A03D',
    goldLight: 'rgba(212, 160, 61, 0.12)',
    textOnGold: '#111827',
    info: '#2563EB',
    infoLight: 'rgba(37, 99, 235, 0.1)',
    inputBg: '#F1F5F9',
    live: '#16A34A',
    notification: '#DC2626',
    textOnNotification: '#FFFFFF',
    orange: '#EA580C',
    orangeLight: 'rgba(234, 88, 12, 0.1)',
    pending: '#CA8A04',
    primary: '#3B82F6',
    primaryLight: 'rgba(59, 130, 246, 0.1)',
    processing: '#2563EB',
    returned: '#9333EA',
    shipped: '#7C3AED',
    success: '#16A34A',
    successLight: 'rgba(22, 163, 74, 0.1)',
    text: '#0F172A',
    textMuted: '#94A3B8',
    textOnPrimary: '#FFFFFF',
    textSecondary: '#64748B',
    placeholder: '#475569',
    warning: '#CA8A04',
    warningLight: 'rgba(202, 138, 4, 0.1)',
    cancelled: '#DC2626',
    delivered: '#16A34A',
  };

  it('renders the product brand and reports updates through onChange', () => {
    const onChange = vi.fn();

    render(
      <ProductBasicInformationCard
        categories={[{ id: 'smartwatch', name: 'Smartwatches' }]}
        colors={colors}
        formData={{
          brand: 'Apple',
          category: 'Smartwatches',
          category_id: 'smartwatch',
          color: 'Midnight',
          description: 'Fitness watch',
          name: 'Apple Watch SE 3',
          sku: 'WATCH-001',
        }}
        isEditing
        onChange={onChange}
        onOpenCategoryModal={vi.fn()}
        onOpenProduct={vi.fn()}
        productNameSuggestions={[]}
      />
    );

    expect(screen.getByDisplayValue('Apple')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('Apple'), {
      target: { value: 'Samsung' },
    });

    expect(onChange).toHaveBeenCalledWith({ brand: 'Samsung' });
  });

  it('falls back to the default category label and opens the category modal', () => {
    const onOpenCategoryModal = vi.fn();

    render(
      <ProductBasicInformationCard
        categories={[{ id: 'smartwatch', name: 'Smartwatches' }]}
        colors={colors}
        formData={{
          brand: 'Apple',
          category: '',
          category_id: 'unknown',
          color: 'Midnight',
          description: 'Fitness watch',
          name: 'Apple Watch SE 3',
          sku: 'WATCH-001',
        }}
        isEditing
        onChange={vi.fn()}
        onOpenCategoryModal={onOpenCategoryModal}
        onOpenProduct={vi.fn()}
        productNameSuggestions={[]}
      />
    );

    expect(screen.getByText('Select Category')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Select category' }));

    expect(onOpenCategoryModal).toHaveBeenCalledTimes(1);
  });

  it('labels the parent SKU optional for variant products', () => {
    render(
      <ProductBasicInformationCard
        categories={[]}
        colors={colors}
        formData={{
          brand: 'Xiaomi',
          category: 'Smartphones',
          category_id: 'smartphones',
          color: '',
          description: 'Phone',
          name: 'Xiaomi Redmi A7',
          sku: '',
        }}
        hasVariants
        isEditing
        onChange={vi.fn()}
        onOpenCategoryModal={vi.fn()}
        onOpenProduct={vi.fn()}
        productNameSuggestions={[]}
      />
    );

    expect(screen.getByText('SKU (optional)')).toBeInTheDocument();
  });
});
