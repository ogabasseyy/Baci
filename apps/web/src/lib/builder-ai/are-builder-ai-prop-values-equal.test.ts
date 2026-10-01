import { MAX_BUILDER_DATA_DEPTH } from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import { areBuilderAiPropValuesEqual } from './are-builder-ai-prop-values-equal';

describe('areBuilderAiPropValuesEqual', () => {
  it('matches equivalent editable lists and objects by value', () => {
    expect(
      areBuilderAiPropValuesEqual(
        [{ description: 'Fast', icon: 'truck', title: 'Delivery' }],
        [{ description: 'Fast', icon: 'truck', title: 'Delivery' }]
      )
    ).toBe(true);
    expect(
      areBuilderAiPropValuesEqual(
        { show: true, text: 'Shop', url: '/products' },
        { show: true, text: 'Shop', url: '/products' }
      )
    ).toBe(true);
  });

  it('rejects structurally different or over-budget values', () => {
    expect(areBuilderAiPropValuesEqual(['a'], ['b'])).toBe(false);
    expect(
      areBuilderAiPropValuesEqual(
        Array.from({ length: 101 }, () => 'a'),
        Array.from({ length: 101 }, () => 'a')
      )
    ).toBe(false);
  });

  it('matches self-referential object pairs by their non-cyclic values', () => {
    // Arrange
    const left: Record<string, unknown> = { title: 'Support' };
    const right: Record<string, unknown> = { title: 'Support' };
    left.self = left;
    right.self = right;

    // Act
    const result = areBuilderAiPropValuesEqual(left, right);

    // Assert
    expect(result).toBe(true);
  });

  it('matches equal graphs with a shared subobject in multiple positions', () => {
    // Arrange
    const leftShared = { label: 'Shop', url: '/products' };
    const rightShared = { label: 'Shop', url: '/products' };
    const left = { primary: leftShared, secondary: leftShared };
    const right = { primary: rightShared, secondary: rightShared };

    // Act
    const result = areBuilderAiPropValuesEqual(left, right);

    // Assert
    expect(result).toBe(true);
  });

  it('rejects unequal cyclic object pairs after skipping their cycle', () => {
    // Arrange
    const left: Record<string, unknown> = { title: 'Support' };
    const right: Record<string, unknown> = { title: 'Contact' };
    left.self = left;
    right.self = right;

    // Act
    const result = areBuilderAiPropValuesEqual(left, right);

    // Assert
    expect(result).toBe(false);
  });

  it('rejects a self-cycle paired with a same-label two-node cycle', () => {
    // Arrange
    const left: Record<string, unknown> = { title: 'Support' };
    const right: Record<string, unknown> = { title: 'Support' };
    const rightNext: Record<string, unknown> = { title: 'Support' };
    left.self = left;
    right.self = rightNext;
    rightNext.self = right;

    // Act
    const result = areBuilderAiPropValuesEqual(left, right);

    // Assert
    expect(result).toBe(false);
  });

  it('rejects equal primitive leaves nested beyond the data-depth budget', () => {
    // Arrange
    const left: Record<string, unknown> = {};
    const right: Record<string, unknown> = {};
    let leftNode = left;
    let rightNode = right;
    for (let depth = 0; depth <= MAX_BUILDER_DATA_DEPTH; depth += 1) {
      const leftNext: Record<string, unknown> | string =
        depth === MAX_BUILDER_DATA_DEPTH ? 'same' : {};
      const rightNext: Record<string, unknown> | string =
        depth === MAX_BUILDER_DATA_DEPTH ? 'same' : {};
      leftNode.next = leftNext;
      rightNode.next = rightNext;
      if (typeof leftNext === 'object') leftNode = leftNext;
      if (typeof rightNext === 'object') rightNode = rightNext;
    }

    // Act
    const result = areBuilderAiPropValuesEqual(left, right);

    // Assert
    expect(result).toBe(false);
  });
});
