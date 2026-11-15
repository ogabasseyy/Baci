import { describe, expect, it, vi } from 'vitest';
import { GiglApiClient } from './gigl.auth';
import type { GiglProviderIo, GiglToken } from './gigl.constants';
import { readGiglWaybillCancellation } from './gigl.preshipment-cancellation';

const token: GiglToken = {
  token: 'token',
  userChannelCode: 'ECO-BACI-001',
  customerType: 1,
  expiresAt: Date.now() + 60_000,
};

function setupApi(body: unknown, init: ResponseInit = { status: 200 }) {
  const safeFetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    })
  );
  const log = vi.fn();
  const io: GiglProviderIo = { safeFetch, log };
  const apiClient = new GiglApiClient(io);
  vi.spyOn(apiClient, 'getApiToken').mockResolvedValue(token);
  return { apiClient, io, log };
}

describe('readGiglWaybillCancellation', () => {
  it('reports cancelled when preshipment IsCancelled is true', async () => {
    const { apiClient, io } = setupApi({
      status: 200,
      data: [{ Waybill: 'WB1', IsCancelled: true }],
    });
    await expect(
      readGiglWaybillCancellation(apiClient, io, 'WB1')
    ).resolves.toBe('cancelled');
  });

  it('reports cancelled when the preshipment record is deleted', async () => {
    const { apiClient, io } = setupApi({
      status: 200,
      data: [{ Waybill: 'WB1', IsDeleted: true }],
    });
    await expect(
      readGiglWaybillCancellation(apiClient, io, 'WB1')
    ).resolves.toBe('cancelled');
  });

  it('reports active when the record is not cancelled', async () => {
    const { apiClient, io } = setupApi({
      status: 200,
      data: { Waybill: 'WB1', IsCancelled: false },
    });
    await expect(
      readGiglWaybillCancellation(apiClient, io, 'WB1')
    ).resolves.toBe('active');
  });

  it('ignores cancelled records for other waybills', async () => {
    const { apiClient, io } = setupApi({
      status: 200,
      data: [{ Waybill: 'OTHER', IsCancelled: true }],
    });
    await expect(
      readGiglWaybillCancellation(apiClient, io, 'WB1')
    ).resolves.toBe('unknown');
  });

  it('reports unknown on HTTP failure without throwing', async () => {
    const { apiClient, io } = setupApi({ status: 500 }, { status: 500 });
    await expect(
      readGiglWaybillCancellation(apiClient, io, 'WB1')
    ).resolves.toBe('unknown');
  });
});
