import { describe, expect, it } from 'vitest';
import { formatAdminSourceLabel } from './admin-source-label';

describe('formatAdminSourceLabel', () => {
  it('uses the product labels for known acquisition and sales sources', () => {
    expect(formatAdminSourceLabel('mobile_app')).toBe('Mobile App');
    expect(formatAdminSourceLabel('whatsapp')).toBe('WhatsApp');
  });

  it('formats an unknown source without losing its words', () => {
    expect(formatAdminSourceLabel('partner-referral')).toBe('Partner Referral');
  });
});
