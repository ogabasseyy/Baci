import { describe, expect, it } from 'vitest';
import { validateJumiaAttributeValueSet } from './attribute-value-set';
import type { JumiaDraftAttribute } from './attribute-values';

const option = {
  id: 10,
  sid: '11111111-1111-4111-8111-111111111111',
  name: 'Red',
  position: 0,
  isDefault: true,
  status: 'ACTIVE' as const,
};
const attribute = (
  options: JumiaDraftAttribute['options']
): JumiaDraftAttribute => ({
  code: 1,
  name: 'value',
  description: '',
  type: 3,
  mandatory: true,
  variation: false,
  translatable: false,
  options,
});

describe('Jumia attribute value-set plain-data containers', () => {
  it('rejects the exact array-owned some bypass for unlisted nonnumeric selections', () => {
    const choices = ['not-a-numeric-option'];
    Object.defineProperty(choices, 'some', { value: () => false });
    expect(
      validateJumiaAttributeValueSet([attribute([option])], { '1': choices })
        .success
    ).toBe(false);
  });
  it.each([
    'some',
    'every',
    'map',
    'filter',
    Symbol.iterator,
  ])('rejects array-owned %s accessors safely across every input position', (key) => {
    for (const location of ['definitions', 'options', 'selections']) {
      const options = [option];
      const definitions = [attribute(options)];
      const selections = [10];
      const target =
        location === 'definitions'
          ? definitions
          : location === 'options'
            ? options
            : selections;
      Object.defineProperty(target, key, {
        get: () => {
          throw new Error('Array accessor must not execute');
        },
      });
      expect(
        validateJumiaAttributeValueSet(definitions, { '1': selections }).success
      ).toBe(false);
    }
  });
  it.each([
    'some',
    'every',
    'map',
    'filter',
    Symbol.iterator,
  ])('rejects array-owned %s methods without executing input behavior', (key) => {
    const options = [option];
    Object.defineProperty(options, key, { value: () => false });
    expect(
      validateJumiaAttributeValueSet([attribute(options)], { '1': [10] })
        .success
    ).toBe(false);
  });
});
