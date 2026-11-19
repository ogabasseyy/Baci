import { describe, expect, it, vi } from 'vitest';
import { readGiglWebhookConfig } from './gigl-webhook-config';

vi.mock('server-only', () => ({}));

const env = {
  GIGL_WEBHOOK_ENCRYPTION_SECRET: ' registration-secret ',
  GIGL_WEBHOOK_USER_ID: 'a1b2c3d4-0000-4000-8000-000000000001',
  GIGL_WEBHOOK_CHANNEL_CODE: 'IND000001',
};

describe('readGiglWebhookConfig', () => {
  it('returns the trimmed settings when all three are present', () => {
    expect(readGiglWebhookConfig(env)).toEqual({
      secret: 'registration-secret',
      userId: 'a1b2c3d4-0000-4000-8000-000000000001',
      channelCode: 'IND000001',
    });
  });

  it.each([
    'GIGL_WEBHOOK_ENCRYPTION_SECRET',
    'GIGL_WEBHOOK_USER_ID',
    'GIGL_WEBHOOK_CHANNEL_CODE',
  ])('fails closed when %s is missing or blank', (name) => {
    expect(readGiglWebhookConfig({ ...env, [name]: undefined })).toBeNull();
    expect(readGiglWebhookConfig({ ...env, [name]: '  ' })).toBeNull();
  });

  it('ignores the legacy GIGL_WEBHOOK_SECRET name', () => {
    expect(
      readGiglWebhookConfig({
        GIGL_WEBHOOK_SECRET: 'legacy-hmac-secret',
        GIGL_WEBHOOK_USER_ID: env.GIGL_WEBHOOK_USER_ID,
        GIGL_WEBHOOK_CHANNEL_CODE: env.GIGL_WEBHOOK_CHANNEL_CODE,
      })
    ).toBeNull();
  });
});
