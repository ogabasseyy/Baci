import { describe, expect, it } from 'vitest';
import { order } from '../../../setup';
import {
  fixtureCustomerEmail,
  json,
  orderResponse,
  scenario,
} from './fixture-response';

describe('checkout fixture responses', () => {
  it('creates a JSON response with the requested status', async () => {
    const response = json({ error: 'fixture error' }, 503);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'fixture error' });
  });

  it('returns default and request-specific fixture order identity', () => {
    expect(orderResponse()).toEqual({
      order,
      amountDueToGateway: 107500,
    });
    expect(
      orderResponse({ customer_email: 'reviewer@example.test' })
    ).toMatchObject({
      order: { customer_email: 'reviewer@example.test' },
      amountDueToGateway: 107500,
    });
  });

  it('decodes the synthetic customer cookie and fails closed when malformed', () => {
    const request = new Request('http://localhost', {
      headers: {
        cookie:
          'other=value; checkout-qa-customer-email=reviewer%40example.test',
      },
    });
    expect(fixtureCustomerEmail(request)).toBe('reviewer@example.test');
    expect(
      fixtureCustomerEmail(
        new Request('http://localhost', {
          headers: { cookie: 'checkout-qa-customer-email=%E0%A4%A' },
        })
      )
    ).toBeUndefined();
    expect(
      fixtureCustomerEmail(new Request('http://localhost'))
    ).toBeUndefined();
  });

  it('reads the provider scenario from the query and defaults to success', () => {
    expect(
      scenario(new Request('http://localhost/api?scenario=provider-error'))
    ).toBe('provider-error');
    expect(scenario(new Request('http://localhost/api'))).toBe('success');
  });
});
