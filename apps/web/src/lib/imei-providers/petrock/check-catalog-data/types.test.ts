import { expect, it } from 'vitest';
import { mappedCheck } from './types';

it('defaults provider evidence to unverified with no observed fields or notes', () => {
  expect(
    mappedCheck('1940', 'deviceModel', 0.04, 'IMEI', ['imei'], {
      supplierName: 'Model check',
      turnaround: null,
      inputType: 'imei',
    })
  ).toMatchObject({ evidence: 'unverified', observedFields: [], notes: [] });
});

it('preserves explicitly observed evidence and input restrictions', () => {
  expect(
    mappedCheck('1940', 'deviceModel', 0.04, 'IMEI', ['imei'], {
      supplierName: 'Model check',
      turnaround: '1 minute',
      inputType: 'imei',
      evidence: 'successful_probe',
      observedFields: ['model'],
      notes: ['observed'],
      serialLengths: [15],
      brandScope: ['apple'],
      deviceScope: ['smartphone'],
    })
  ).toMatchObject({
    evidence: 'successful_probe',
    observedFields: ['model'],
    notes: ['observed'],
    serialLengths: [15],
    brandScope: ['apple'],
    deviceScope: ['smartphone'],
  });
});
