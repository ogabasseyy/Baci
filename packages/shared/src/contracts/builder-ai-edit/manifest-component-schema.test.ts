import { describe, expect, it } from 'vitest';
import { builderDesignCapabilities } from '../builder-design-capabilities';
import { builderDesignCapabilityAdapter } from '../builder-design-capability-adapter';
import { getManifestComponentSchema } from './manifest-component-schema';

describe('manifest component schema', () => {
  it('uses manifest bounds and uniqueness for editable component patches', () => {
    const schema = getManifestComponentSchema('edit');

    expect(
      schema.safeParse({ componentType: 'Button', text: 'x'.repeat(121) })
        .success
    ).toBe(false);
    expect(
      schema.safeParse({
        componentType: 'FAQ',
        items: [
          { answer: 'First', question: 'Shipping' },
          { answer: 'Second', question: 'Shipping' },
        ],
      }).success
    ).toBe(false);
  });

  it('accepts default-only manifest-authorized inserts and rejects protected types', () => {
    const schema = getManifestComponentSchema('insert');

    expect(schema.safeParse({ componentType: 'Button' }).success).toBe(true);
    expect(schema.safeParse({ componentType: 'CodeEmbed' }).success).toBe(
      false
    );
  });

  it('fails closed when a manifest descriptor has no compiled validator', () => {
    const button = builderDesignCapabilities.components.find(
      ({ componentType }) => componentType === 'Button'
    );
    const descriptor = button?.props.text;
    if (!descriptor) throw new Error('Expected Button text descriptor');
    const originalType = descriptor.type;

    try {
      descriptor.type = 'unreviewed-descriptor';
      expect(() => getManifestComponentSchema('edit')).toThrow(
        'Unsupported manifest descriptor type: unreviewed-descriptor'
      );
    } finally {
      descriptor.type = originalType;
    }
  });

  it('rejects an enum-bearing descriptor whose type is not recognized', () => {
    const button = builderDesignCapabilities.components.find(
      ({ componentType }) => componentType === 'Button'
    );
    const descriptor = button?.props.align;
    if (!descriptor) throw new Error('Expected Button align descriptor');
    const originalType = descriptor.type;
    const originalEnum = descriptor.enum;

    try {
      descriptor.type = 'unreviewed-descriptor';
      descriptor.enum = ['center'];

      expect(() => getManifestComponentSchema('edit')).toThrow(
        'Unsupported manifest descriptor type: unreviewed-descriptor'
      );
      expect(
        builderDesignCapabilityAdapter.isPropValue('Button', 'align', 'center')
      ).toBe(false);
    } finally {
      descriptor.type = originalType;
      descriptor.enum = originalEnum;
    }
  });
});
