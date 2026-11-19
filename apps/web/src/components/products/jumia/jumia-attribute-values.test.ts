import { describe, expect, it } from 'vitest';
import {
  attributeUnavailableReason,
  type JumiaDraftAttribute,
  validateAttributeValue,
} from './jumia-attribute-values';

const attribute = (
  type: number,
  extra: Partial<JumiaDraftAttribute> = {}
): JumiaDraftAttribute => ({
  code: 1,
  name: 'Value',
  description: '',
  type,
  mandatory: true,
  variation: false,
  translatable: false,
  ...extra,
});

describe('public Jumia UI attribute validation compatibility', () => {
  it('keeps an unset boolean distinct from false and rejects string coercion', () => {
    expect(validateAttributeValue(attribute(6), false)).toBeNull();
    expect(validateAttributeValue(attribute(6), 'false')).not.toBeNull();
  });
  it('requires format/options for required controls while optional unavailable metadata can be omitted', () => {
    for (const type of [3, 4, 5, 7, 99]) {
      expect(attributeUnavailableReason(attribute(type))).not.toBeNull();
      expect(validateAttributeValue(attribute(type), 'made-up')).not.toBeNull();
      expect(
        validateAttributeValue(attribute(type, { mandatory: false }), undefined)
      ).toBeNull();
    }
  });
});
