import { describe, expect, it } from 'vitest';
import { retailRelation } from './classify-durable-product-seo-retail-relation';

describe('retailRelation', () => {
  it('detects commerce headings preceding prices', () => {
    const text = 'Flash sale: 500';
    const relation = retailRelation(text, 12);
    expect(relation.strong).toBe(true);
    expect(relation.cue).toBe('heading');
  });

  it('detects possessive price phrasing', () => {
    const text = 'This phone has a price of 999';
    const relation = retailRelation(text, 26);
    expect(relation.strong).toBe(true);
    expect(relation.predicate).toBe(true);
    expect(relation.cue).toBe('possessive');
  });

  it.each([
    { text: 'Was 999, now 799', firstStart: 4, secondStart: 13 },
    { text: 'Was 999, now 799 per unit', firstStart: 4, secondStart: 13 },
    { text: 'Was 999, now 799 per kg', firstStart: 4, secondStart: 13 },
    { text: 'Was 999, now 799 for all models', firstStart: 4, secondStart: 13 },
    { text: 'This model was 999, now 799', firstStart: 15, secondStart: 24 },
    {
      text: 'Sale: Was 999, now 799 on new models',
      firstStart: 10,
      secondStart: 19,
    },
  ])('detects paired was/now sale pricing on both amounts: $text', ({
    text,
    firstStart,
    secondStart,
  }) => {
    const firstRelation = retailRelation(text, firstStart);
    expect(firstRelation.strong).toBe(true);
    expect(firstRelation.cue).toBe('paired');

    const secondRelation = retailRelation(text, secondStart);
    expect(secondRelation.strong).toBe(true);
    expect(secondRelation.cue).toBe('paired');
  });

  it('detects commercial and purchase context', () => {
    const buyText = 'Buy iPhone 13 for 500';
    const buyRelation = retailRelation(buyText, 18);
    expect(buyRelation.purchase).toBe(true);
    expect(buyRelation.cue).toBe('for');

    const sellText = 'Available for 500';
    const sellRelation = retailRelation(sellText, 14);
    expect(sellRelation.commercial).toBe(true);
  });

  it('detects pipe and dash separators', () => {
    expect(retailRelation('| 500', 2).separator).toBe(true);
    expect(retailRelation('- 500', 2).separator).toBe(true);
  });

  it('distinguishes identifier predicates from price cues', () => {
    const text = 'Model number: 500';
    const relation = retailRelation(text, 14);
    expect(relation.identifierPredicate).toBe(true);
    expect(relation.strong).toBe(false);
  });

  it.each([
    {
      text: 'Battery life was 900, now 800 cycles',
      firstStart: 17,
      secondStart: 26,
    },
    {
      text: 'Battery life was 900, now 800 charging cycles',
      firstStart: 17,
      secondStart: 26,
    },
    {
      text: 'Energy consumption was 900, now 800 kWh',
      firstStart: 23,
      secondStart: 32,
    },
    {
      text: 'The rating was 4.8, now 4.9',
      firstStart: 15,
      secondStart: 24,
    },
  ])('excludes unit-bearing specification updates from paired sales: $text', ({
    text,
    firstStart,
    secondStart,
  }) => {
    const first = retailRelation(text, firstStart);
    expect(first.strong).toBe(false);
    expect(first.cue).not.toBe('paired');

    const second = retailRelation(text, secondStart);
    expect(second.strong).toBe(false);
    expect(second.cue).not.toBe('paired');
  });
});
