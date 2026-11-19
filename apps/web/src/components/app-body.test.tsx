import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MerchantData } from '@/hooks/use-merchant';
import AppBody from './app-body';

vi.mock('next/dynamic', () => ({
  default: () => {
    const Stub = () => <div data-testid="dynamic-stub" />;
    Stub.displayName = 'DynamicStub';
    return Stub;
  },
}));

const merchantWithBrandColors: MerchantData = {
  id: 'merchant-1',
  user_id: 'user-1',
  business_name: 'Test Merchant',
  business_type: 'retail',
  brand_colors: {
    primary: '#1D4ED8',
    background: '#F8FAFC',
    accent: '#F59E0B',
  },
};

describe('AppBody', () => {
  it('renders a partial merchant theme without requiring merchant account fields', () => {
    const { container } = render(
      <AppBody merchant={{ brand_colors: { primary: '#1D4ED8' } }}>
        <main>Content with partial branding</main>
      </AppBody>
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(screen.getByRole('main')).toHaveTextContent(
      'Content with partial branding'
    );
    expect(wrapper.style.getPropertyValue('--store-primary')).toBe('#1D4ED8');
    expect(wrapper.style.getPropertyValue('--store-primary-text')).toBe(
      '#FFFFFF'
    );
    expect(wrapper.style.getPropertyValue('--background')).toBe('');
    expect(wrapper.style.getPropertyValue('--card')).toBe('');
    expect(wrapper.style.getPropertyValue('--accent')).toBe('');
    expect(wrapper.style.getPropertyValue('--store-background-text')).toBe('');
    expect(wrapper.style.getPropertyValue('--store-accent-text')).toBe('');
  });

  it.each([
    { background: '#F8FAFC' },
    { accent: '#F59E0B' },
    {},
  ])('emits tokens only for supplied color channels %s', (brandColors) => {
    const { container } = render(
      <AppBody merchant={{ brand_colors: brandColors }}>Partial theme</AppBody>
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.getPropertyValue('--primary')).toBe('');
    expect(wrapper.style.getPropertyValue('--ring')).toBe('');
    expect(wrapper.style.getPropertyValue('--store-primary-text')).toBe('');
    expect(Boolean(wrapper.style.getPropertyValue('--background'))).toBe(
      'background' in brandColors
    );
    expect(Boolean(wrapper.style.getPropertyValue('--accent'))).toBe(
      'accent' in brandColors
    );
  });

  it('applies core theme variables when merchant core theme override is enabled', () => {
    const { container } = render(
      <AppBody merchant={merchantWithBrandColors}>
        <div>Storefront content</div>
      </AppBody>
    );

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.getPropertyValue('--background')).not.toBe('');
    expect(wrapper.style.getPropertyValue('--card')).not.toBe('');
  });

  it('does not override core theme variables when merchant core theme override is disabled', () => {
    const { container } = render(
      <AppBody
        merchant={merchantWithBrandColors}
        applyMerchantCoreThemeVariables={false}
      >
        <div>Dashboard content</div>
      </AppBody>
    );

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.getPropertyValue('--background')).toBe('');
    expect(wrapper.style.getPropertyValue('--card')).toBe('');

    // Brand accent/primary tokens stay available for merchant UI accents.
    expect(wrapper.style.getPropertyValue('--primary')).not.toBe('');
    expect(wrapper.style.getPropertyValue('--store-primary')).not.toBe('');
    expect(wrapper.style.getPropertyValue('--store-on-primary')).not.toBe('');
    expect(wrapper.style.getPropertyValue('--store-border')).not.toBe('');
  });

  it('renders cookie consent by default when newsletter widget is disabled', () => {
    render(
      <AppBody showNewsletterWidget={false}>
        <div>Storefront content</div>
      </AppBody>
    );

    expect(screen.getByTestId('dynamic-stub')).toBeInTheDocument();
  });

  it('does not render cookie consent when showCookieConsent is false', () => {
    render(
      <AppBody showCookieConsent={false} showNewsletterWidget={false}>
        <div>Storefront content</div>
      </AppBody>
    );

    expect(screen.queryByTestId('dynamic-stub')).not.toBeInTheDocument();
  });
});
