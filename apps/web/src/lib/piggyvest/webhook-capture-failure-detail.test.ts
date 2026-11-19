import { expect, it } from 'vitest';
import { captureFailureDetail } from './webhook-capture-failure-detail';

it.each([
  null,
  'private exception',
  { message: 'private body', sqlState: 'secret' },
  new Error('private credential'),
])('does not expose untrusted failure detail %#', (error) => {
  expect(captureFailureDetail(error, 'process')).toEqual({ phase: 'process' });
});
it('preserves only an allowlisted SQLSTATE and operation phase', () => {
  expect(
    captureFailureDetail(
      {
        sqlState: '28P01',
        message: 'private credential',
        body: 'private body',
      },
      'renew'
    )
  ).toEqual({ phase: 'renew', sqlState: '28P01' });
});
