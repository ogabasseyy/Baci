import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OgabasseyPdpCriticalCommerceConditionFact,
  OgabasseyPdpCriticalConditionBadge,
} from './critical-commerce-condition.client';

const commerceStateHolder = vi.hoisted(() => ({
  state: null as unknown,
}));

vi.mock('./critical-commerce-state.client', () => ({
  useOptionalOgabasseyPdpCriticalCommerce: () => commerceStateHolder.state,
}));

const axisOptionsHolder = vi.hoisted(() => ({ options: [] as string[] }));

vi.mock('./critical-variant-selector-options', () => ({
  getVariantAxisOptions: () => axisOptionsHolder.options,
}));

describe('critical commerce condition display', () => {
  beforeEach(() => {
    commerceStateHolder.state = null;
    axisOptionsHolder.options = [];
  });

  it('falls back to the formatted fallback condition without commerce state', () => {
    render(<OgabasseyPdpCriticalConditionBadge fallbackCondition="open_box" />);
    expect(screen.getByText('Open Box')).toBeInTheDocument();

    render(
      <OgabasseyPdpCriticalCommerceConditionFact fallbackCondition="used" />
    );
    expect(screen.getByText('Used')).toBeInTheDocument();
  });

  it('renders nothing when no condition resolves', () => {
    const { container } = render(<OgabasseyPdpCriticalConditionBadge />);
    expect(container).toBeEmptyDOMElement();
  });

  it('summarizes mixed new/used variant conditions', () => {
    axisOptionsHolder.options = ['new', 'used'];
    commerceStateHolder.state = {
      productForCart: { condition: 'new' },
      variantAxisOptions: {},
      variants: [],
    };
    render(<OgabasseyPdpCriticalConditionBadge />);
    expect(screen.getByText('New & Used')).toBeInTheDocument();
  });

  it('summarizes three-plus conditions as multiple', () => {
    axisOptionsHolder.options = ['new', 'used', 'open_box'];
    commerceStateHolder.state = {
      productForCart: { condition: 'new' },
      variantAxisOptions: {},
      variants: [],
    };
    render(<OgabasseyPdpCriticalConditionBadge />);
    expect(screen.getByText('Multiple Conditions')).toBeInTheDocument();
  });

  it('prefers the cart condition for the commerce fact', () => {
    commerceStateHolder.state = {
      productForCart: { condition: 'new' },
      variantAxisOptions: {},
      variants: [],
    };
    render(
      <OgabasseyPdpCriticalCommerceConditionFact fallbackCondition="used" />
    );
    expect(screen.getByText('New')).toBeInTheDocument();
  });
});
