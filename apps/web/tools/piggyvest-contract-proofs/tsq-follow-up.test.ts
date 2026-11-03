import { describe, expect, it } from 'vitest';
import { disposition, followUpAfterSubmit } from './tsq-follow-up';

describe('followUpAfterSubmit', () => {
  it.each([
    ['success', 'settled'],
    ['successful', 'settled'],
    ['failed', 'failed'],
    ['pending', 'pending'],
  ])('reads %s as %s', (status, verdict) => {
    expect(followUpAfterSubmit(status).verdict).toBe(verdict);
  });

  it.each([
    'http_404',
    'http_500',
    'http_503',
    'http_429',
    'network_error',
    'processing_weird',
    '',
  ])('reads %s as uncertain, never as a reason to resend', (status) => {
    expect(followUpAfterSubmit(status).verdict).toBe('uncertain');
  });

  it('flags a 404 so the caller can report it separately', () => {
    expect(followUpAfterSubmit('http_404').notFound).toBe(true);
    expect(followUpAfterSubmit('http_503').notFound).toBe(false);
  });

  it('never allows a resend, whatever the status', () => {
    for (const status of [
      'success',
      'failed',
      'pending',
      'http_404',
      'network_error',
    ]) {
      expect(followUpAfterSubmit(status).resend).toBe(false);
    }
  });
});

describe('disposition', () => {
  it('settles on a settled last reading', () => {
    expect(disposition(['uncertain', 'pending', 'settled'])).toBe('settled');
  });

  it('releases the reference (a retry would need a NEW one) only on a definite failure', () => {
    expect(disposition(['uncertain', 'failed'])).toBe(
      'failed_release_new_reference'
    );
  });

  it('holds for reconciliation while the last reading is uncertain or pending', () => {
    expect(disposition(['uncertain'])).toBe('hold_for_reconcile');
    expect(disposition(['pending', 'uncertain'])).toBe('hold_for_reconcile');
    expect(disposition(['settled', 'pending'])).toBe('hold_for_reconcile');
  });

  it('holds when nothing was read at all', () => {
    expect(disposition([])).toBe('hold_for_reconcile');
  });
});
