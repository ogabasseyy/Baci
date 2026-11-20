import { describe, expect, it } from 'vitest';
import { readMonnifyAnswer } from './monnify-answer-reading';

const read = (statusLine: string, body: string) =>
  readMonnifyAnswer(statusLine, body);

describe('readMonnifyAnswer', () => {
  it('reads a known refusal only from the body, not the status line', () => {
    expect(
      read(
        '400 Bad Request',
        '{"responseMessage":"Insufficient wallet balance"}'
      ).isKnownRefusal
    ).toBe(true);
    expect(read('400 Insufficient funds', '').isKnownRefusal).toBe(false);
  });

  it('flags a duplicate from wording or a set flag', () => {
    expect(read('400', 'Duplicate vendReference').isDuplicateReference).toBe(
      true
    );
    expect(read('400', '{"duplicate":true}').isDuplicateReference).toBe(true);
    expect(read('400', '{"duplicate":false}').isDuplicateReference).toBe(false);
  });

  it('flags code 99 as an unexpected error', () => {
    expect(read('400', '{"responseCode":"99"}').reportsUnexpectedError).toBe(
      true
    );
    expect(read('400', '{"responseCode":"01"}').reportsUnexpectedError).toBe(
      false
    );
  });

  it('reads auth wording from the reason phrase too', () => {
    expect(read('400 Unauthorized', '{}').mentionsAuthWording).toBe(true);
  });

  it('leaves the outcome open for a PENDING vend status in the body', () => {
    expect(
      read('400', '{"responseBody":{"vendStatus":"PENDING"}}').leavesOutcomeOpen
    ).toBe(true);
  });

  it('leaves the outcome open when only the reason phrase says in progress', () => {
    expect(read('400 Vend in progress', '').leavesOutcomeOpen).toBe(true);
  });

  it('does not leave the outcome open for a plain refusal', () => {
    expect(
      read(
        '400 Bad Request',
        '{"responseMessage":"Invalid customer reference"}'
      ).leavesOutcomeOpen
    ).toBe(false);
  });

  it("finds Monnify's own vendReference and the response code", () => {
    const reading = read(
      '400',
      '{"responseCode":"99","responseBody":{"vendReference":"MFBP-3"}}'
    );
    expect(reading.vendReferenceCandidate).toBe('MFBP-3');
    expect(reading.responseCode).toBe('99');
  });
});

describe('bugfix: negated duplicate wording in an HTTP error', () => {
  it.each([
    'Not a duplicate, vend rejected',
    'No duplicate reference found',
  ])('is not a duplicate: "%s"', (body) => {
    expect(read('400', body).isDuplicateReference).toBe(false);
  });

  it('still flags a real duplicate', () => {
    expect(read('400', 'Duplicate vendReference').isDuplicateReference).toBe(
      true
    );
  });
});
