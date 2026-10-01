import { describe, expect, it, vi } from 'vitest';
import { notificationActionUrl } from './notification-action-url';

describe('notificationActionUrl', () => {
  it('accepts explicit same-site paths and HTTPS URLs', () => {
    expect(notificationActionUrl.parse('/dashboard/orders?tab=open')).toBe(
      '/dashboard/orders?tab=open'
    );
    expect(notificationActionUrl.parse(' https://usebaci.com/help ')).toBe(
      'https://usebaci.com/help'
    );
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,alert(1)',
    'http://example.com',
    '//example.com',
    '/\\example.com',
    'https://example.com/\u0000payload',
  ])('rejects unsafe action URL %j', (value) => {
    expect(notificationActionUrl.parse(value)).toBeNull();
  });

  it('does not open an unsafe persisted action URL', () => {
    const open = vi.spyOn(window, 'open');

    expect(notificationActionUrl.open('javascript:alert(1)')).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('opens a safe action URL without an opener reference', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);

    expect(notificationActionUrl.open('/dashboard/orders')).toBe(true);
    expect(open).toHaveBeenCalledWith(
      '/dashboard/orders',
      '_blank',
      'noopener,noreferrer'
    );
  });
});
