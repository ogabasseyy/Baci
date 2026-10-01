import { describe, expect, it } from 'vitest';
import { builderDesignCapabilityAdapter } from './builder-design-capability-adapter';

describe('builder design capability adapter', () => {
  it('derives the Button safe insertion default from its manifest descriptor', () => {
    expect(builderDesignCapabilityAdapter.getDefaults('Button')).toMatchObject({
      link: '/',
      text: 'Click Me',
    });
  });

  it('enforces manifest safe links, bounds, and unique FAQ members', () => {
    expect(
      builderDesignCapabilityAdapter.isPropValue(
        'Button',
        'link',
        'javascript:alert(1)'
      )
    ).toBe(false);
    expect(
      builderDesignCapabilityAdapter.isPropValue('Button', 'link', '/products')
    ).toBe(true);
    expect(
      builderDesignCapabilityAdapter.isPropValue('Button', 'link', '#')
    ).toBe(true);
    expect(
      builderDesignCapabilityAdapter.isPropValue(
        'Button',
        'link',
        `/${'a'.repeat(512)}`
      )
    ).toBe(false);
    expect(
      builderDesignCapabilityAdapter.isPropValue('FAQ', 'items', [
        { answer: 'One', question: 'Shipping?' },
        { answer: 'Two', question: 'Shipping?' },
      ])
    ).toBe(false);
    expect(
      builderDesignCapabilityAdapter.isPropValue(
        'FAQ',
        'items',
        Array.from({ length: 13 }, (_, index) => ({
          answer: `Answer ${index}`,
          question: `Question ${index}`,
        }))
      )
    ).toBe(false);
  });

  it('rejects explicit undefined nested members while allowing omitted optional members', () => {
    expect(
      builderDesignCapabilityAdapter.isPropValue('Features', 'features', [
        { description: 'Fast delivery', title: 'Shipping' },
      ])
    ).toBe(true);
    expect(
      builderDesignCapabilityAdapter.isPropValue('Features', 'features', [
        {
          description: 'Fast delivery',
          icon: undefined,
          title: 'Shipping',
        },
      ])
    ).toBe(false);
  });

  it('allows clearing optional copy while keeping required Feature copy nonempty', () => {
    expect(
      builderDesignCapabilityAdapter.isPropValue('Features', 'subtitle', '')
    ).toBe(true);
    expect(
      builderDesignCapabilityAdapter.isPropValue('Features', 'features', [
        { description: '', title: 'Shipping' },
      ])
    ).toBe(false);
  });
});
