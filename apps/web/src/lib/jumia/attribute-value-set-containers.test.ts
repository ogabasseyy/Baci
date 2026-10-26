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
  it.each([
    'append',
    'replace',
  ])('keeps accepted selections unchanged after input %s', (mutation) => {
    const selections = [10];
    const result = validateJumiaAttributeValueSet([attribute([option])], {
      '1': selections,
    });
    expect(result.success).toBe(true);
    if (mutation === 'append') selections.push(99);
    else selections[0] = 99;
    expect(result).toEqual({ success: true, values: { '1': [10] } });
  });
  it('keeps caller selections unchanged when accepted output is mutated', () => {
    const selections = [10];
    const result = validateJumiaAttributeValueSet([attribute([option])], {
      '1': selections,
    });
    if (!result.success) throw new Error('Valid selections must succeed');
    const accepted = result.values['1'];
    if (!Array.isArray(accepted)) throw new Error('Expected selection IDs');
    accepted[0] = 99;
    accepted.push(100);
    expect(selections).toEqual([10]);
    expect(accepted).toEqual([99, 100]);
  });
  it.each([
    'input',
    'output',
  ])('owns optional empty selections independently from %s mutations', (side) => {
    const selections: number[] = [];
    const result = validateJumiaAttributeValueSet(
      [{ ...attribute([option]), mandatory: false }],
      { '1': selections }
    );
    if (!result.success)
      throw new Error('Optional empty selections must succeed');
    const accepted = result.values['1'];
    if (!Array.isArray(accepted)) throw new Error('Expected selection IDs');
    if (side === 'input') {
      selections.push(10);
      expect(accepted).toEqual([]);
      expect(selections).toEqual([10]);
    } else {
      accepted.push(10);
      expect(selections).toEqual([]);
      expect(accepted).toEqual([10]);
    }
  });
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
