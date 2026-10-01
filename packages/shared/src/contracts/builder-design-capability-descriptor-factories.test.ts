import { describe, expect, it } from 'vitest';
import {
  allow,
  copy,
  deny,
  label,
} from './builder-design-capability-descriptor-factories';

describe('builder design capability descriptor factories', () => {
  it('creates bounded text descriptors without injecting omitted defaults', () => {
    expect(label()).toEqual({ maximumLength: 120, type: 'string' });
    expect(copy('Details')).toEqual({
      default: 'Details',
      maximumLength: 2000,
      type: 'string',
    });
  });

  it('keeps editable and refused capability boundaries unchanged', () => {
    expect(allow('LegalSection', 'Policy', {}, false, true)).toMatchObject({
      aiEditable: true,
      aiInsertable: false,
      protected: true,
      refused: false,
    });
    expect(
      deny('CodeEmbed', 'Code', 'unsafe-code', 'Not allowed')
    ).toMatchObject({
      aiEditable: false,
      aiInsertable: false,
      protected: true,
      refused: true,
    });
  });
});
