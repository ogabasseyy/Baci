import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KudaServiceType, NetworkProvider } from './kuda'; // Enums are fine to import statically

// Mock dependencies
const MOCK_API_BASE = 'https://kuda-openapi.kuda.com/v2.1';

describe('Kuda API Client', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetModules(); // This wipes the module registry
    vi.stubEnv('KUDA_API_BASE_URL', MOCK_API_BASE);
    vi.stubEnv('KUDA_EMAIL', 'test@example.com');
    vi.stubEnv('KUDA_API_KEY', 'test-api-key');
    vi.useRealTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe('commission rates', () => {
    it('uses biller pricing rates from the current Kuda pricing sheet', async () => {
      const { getCommissionRate } = await import('./kuda');

      expect(getCommissionRate('Glo', 'AIRTIME')).toEqual({ rate: 0.05 });
      expect(getCommissionRate('9mobile', 'DATA')).toEqual({ rate: 0.045 });
      expect(
        getCommissionRate('EKEDC NG - EKEDC PREPAID', 'ELECTRICITY')
      ).toEqual({ rate: 0.01, cap: 4000 });
      expect(getCommissionRate('DSTV', 'CABLE')).toEqual({ rate: 0.016 });
      expect(getCommissionRate('BETPAWA', 'BETTING')).toEqual({ rate: 0.007 });
    });
  });

  // Helper to mock generic Kuda API success response
  const mockKudaResponse = (data: any, message = 'Success') => {
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          status: true,
          message,
          data,
        }),
    } as Response);
  };

  describe('Authentication', () => {
    it('retrieves a token successfully', async () => {
      // Dynamic import to ensure we get a fresh module with null cachedToken
      const { purchaseAirtime } = await import('./kuda');

      const fetchMock = vi.fn().mockImplementation((url, _options) => {
        if (url.toString().includes('GetToken')) {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve('new-token'),
          } as Response);
        }
        return mockKudaResponse({ reference: 'tx-123' });
      });
      globalThis.fetch = fetchMock;

      await purchaseAirtime('08012345678', 100, NetworkProvider.MTN);

      // Verify GetToken was called
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('GetToken'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('test@example.com'),
          signal: expect.any(AbortSignal),
        })
      );
    });

    it('fails fast when the token request times out', async () => {
      const { purchaseAirtime } = await import('./kuda');
      vi.useFakeTimers();

      globalThis.fetch = vi.fn().mockImplementation((_url, options) => {
        const signal = options?.signal as AbortSignal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true }
          );
        });
      });

      const purchasePromise = purchaseAirtime(
        '08012345678',
        100,
        NetworkProvider.MTN
      );

      await vi.advanceTimersByTimeAsync(15000);

      await expect(purchasePromise).resolves.toMatchObject({
        success: false,
        message: 'Purchase failed',
      });
    });
  });

  describe('purchaseAirtime', () => {
    it('sends correct payload for MTN airtime purchase', async () => {
      const { purchaseAirtime } = await import('./kuda');

      const fetchMock = vi.fn().mockImplementation((url) => {
        if (url.toString().includes('GetToken')) {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve('valid-token'),
          } as Response);
        }
        return mockKudaResponse({ reference: 'tx-mtn-123', pin: null });
      });
      globalThis.fetch = fetchMock;

      const result = await purchaseAirtime(
        '08030000000',
        500,
        NetworkProvider.MTN
      );

      expect(result.success).toBe(true);
      expect(result.transactionId).toBe('tx-mtn-123');

      // Find the actual purchase call (not the auth one)
      const purchaseCall = fetchMock.mock.calls.find(
        (call) => call[0] === MOCK_API_BASE
      );
      expect(purchaseCall).toBeDefined();

      const payload = JSON.parse(purchaseCall?.[1]?.body as string);
      expect(payload.serviceType).toBe(KudaServiceType.ADMIN_PURCHASE_BILL);
      expect(purchaseCall?.[1]?.signal).toBeInstanceOf(AbortSignal);
      expect(payload.Data.BillItemIdentifier).toBe('KD-VTU-MTNNG');
      expect(payload.Data.Amount).toBe('50000'); // 500 Naira = 50000 Kobo
      expect(payload.Data.PhoneNumber).toBe('08030000000');
      expect(result.reference).toBeDefined();
      expect(payload.Data.trackingReference).toBe(result.reference);
    });

    it('handles API errors gracefully', async () => {
      const { purchaseAirtime } = await import('./kuda');

      const fetchMock = vi.fn().mockImplementation((url) => {
        if (url.toString().includes('GetToken'))
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve('token'),
          } as Response);

        // Return failure from Kuda
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              status: false,
              message: 'Insufficient balance',
            }),
        } as Response);
      });
      globalThis.fetch = fetchMock;

      const result = await purchaseAirtime(
        '08030000000',
        500000,
        NetworkProvider.MTN
      );

      expect(result.success).toBe(false);
      expect(result.status).toBe('failed');
      expect(result.message).toBe('Insufficient balance');
    });

    it('returns a timeout error when the purchase request stalls', async () => {
      const { purchaseAirtime } = await import('./kuda');
      vi.useFakeTimers();

      globalThis.fetch = vi.fn().mockImplementation((url, options) => {
        if (url.toString().includes('GetToken')) {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve('token'),
          } as Response);
        }

        const signal = options?.signal as AbortSignal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true }
          );
        });
      });

      const purchasePromise = purchaseAirtime(
        '08030000000',
        500,
        NetworkProvider.MTN
      );

      await vi.advanceTimersByTimeAsync(15000);

      const result = await purchasePromise;

      expect(result.success).toBe(false);
      expect(result.message).toBe('Purchase failed');
      // Codex R102 P1: a timeout after Kuda accepts still lands the
      // vend — pending routes to BILL_TSQ reconciliation instead of
      // refunding on top of delivered value.
      expect(result.status).toBe('pending');
    });

    it('returns error for invalid network provider', async () => {
      const { purchaseAirtime } = await import('./kuda');
      // @ts-expect-error - Testing invalid input
      const result = await purchaseAirtime('08030000000', 100, 'INVALID_NET');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid network provider');
    });

    it('fails outright only on definitive 4xx rejections, pending on 5xx', async () => {
      // Codex R102 P1: a received 4xx proves Kuda rejected (safe to
      // fail + refund); a 5xx may have landed (pending + requery).
      const { purchaseAirtime } = await import('./kuda');

      for (const status of [400, 404]) {
        vi.stubGlobal(
          'fetch',
          vi.fn().mockImplementation((url) => {
            if (url.toString().includes('GetToken')) {
              return Promise.resolve({
                ok: true,
                text: () => Promise.resolve('token'),
              } as Response);
            }
            return Promise.resolve({
              ok: false,
              status,
              statusText: 'Bad Request',
            } as Response);
          })
        );
        const rejected = await purchaseAirtime(
          '08030000000',
          100,
          NetworkProvider.MTN
        );
        expect(rejected).toMatchObject({ success: false, status: 'failed' });
      }

      for (const status of [500, 503]) {
        vi.stubGlobal(
          'fetch',
          vi.fn().mockImplementation((url) => {
            if (url.toString().includes('GetToken')) {
              return Promise.resolve({
                ok: true,
                text: () => Promise.resolve('token'),
              } as Response);
            }
            return Promise.resolve({
              ok: false,
              status,
              statusText: 'Server Error',
            } as Response);
          })
        );
        const unknown = await purchaseAirtime(
          '08030000000',
          100,
          NetworkProvider.MTN
        );
        expect(unknown).toMatchObject({ success: false, status: 'pending' });
      }
      vi.unstubAllGlobals();
    });

    it('resolves connection drops as pending', async () => {
      // Codex R102 P1: the drop may follow Kuda's acceptance.
      const { purchaseAirtime } = await import('./kuda');
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url) => {
          if (url.toString().includes('GetToken')) {
            return Promise.resolve({
              ok: true,
              text: () => Promise.resolve('token'),
            } as Response);
          }
          return Promise.reject(new TypeError('fetch failed'));
        })
      );
      try {
        const result = await purchaseAirtime(
          '08030000000',
          100,
          NetworkProvider.MTN
        );
        expect(result).toMatchObject({ success: false, status: 'pending' });
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe('purchaseData', () => {
    it('sends correct payload for Data purchase', async () => {
      const { purchaseData } = await import('./kuda');

      const fetchMock = vi.fn().mockImplementation((url) => {
        if (url.toString().includes('GetToken'))
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve('token'),
          } as Response);
        return mockKudaResponse({ reference: 'tx-data-123' });
      });
      globalThis.fetch = fetchMock;

      const dataPlanCode = 'MTN-1GB-MONTHLY';
      const result = await purchaseData(
        '08030000000',
        dataPlanCode,
        1000,
        NetworkProvider.MTN
      );

      expect(result.success).toBe(true);

      const purchaseCall = fetchMock.mock.calls.find(
        (call) => call[0] === MOCK_API_BASE
      );
      const payload = JSON.parse(purchaseCall?.[1]?.body as string);

      expect(payload.Data.BillItemIdentifier).toBe(dataPlanCode);
      expect(payload.Data.Amount).toBe('100000'); // 1000 Naira = 100000 Kobo
      expect(payload.Data.trackingReference).toBe(result.reference);
    });

    it('resolves connection drops as pending', async () => {
      // Codex R102 P1: the drop may follow Kuda's acceptance.
      const { purchaseData } = await import('./kuda');
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url) => {
          if (url.toString().includes('GetToken')) {
            return Promise.resolve({
              ok: true,
              text: () => Promise.resolve('token'),
            } as Response);
          }
          return Promise.reject(new TypeError('fetch failed'));
        })
      );
      try {
        const result = await purchaseData(
          '08030000000',
          'MTN-1GB-MONTHLY',
          1000,
          NetworkProvider.MTN
        );
        expect(result).toMatchObject({ success: false, status: 'pending' });
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe('checkTransactionStatus', () => {
    it('queries bill status by response ref, then request ref, and returns the token', async () => {
      const { checkTransactionStatus } = await import('@/lib/kuda');

      const fetchMock = vi.fn().mockImplementation((url, options) => {
        if (url.toString().includes('GetToken')) {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve('token'),
          } as Response);
        }

        const payload = JSON.parse(String(options?.body));
        if (payload.Data.BillResponseReference) {
          return mockKudaResponse({ finalStatus: 'successful' }, 'No token');
        }

        return mockKudaResponse(
          { FinalStatus: 'successful', Pin: '1234-5678-9012' },
          'Token found'
        );
      });
      globalThis.fetch = fetchMock;

      const result = await checkTransactionStatus('kuda-bill-1', 'VTU-123');

      expect(result).toEqual({
        message: 'Token found',
        pin: '1234-5678-9012',
        status: 'successful',
      });

      const statusPayloads = fetchMock.mock.calls
        .filter((call) => call[0] === MOCK_API_BASE)
        .map((call) => JSON.parse(String(call[1]?.body)));
      expect(statusPayloads).toEqual([
        expect.objectContaining({
          Data: { BillResponseReference: 'kuda-bill-1' },
          serviceType: KudaServiceType.BILL_TSQ,
        }),
        expect.objectContaining({
          Data: { BillRequestRef: 'VTU-123' },
          serviceType: KudaServiceType.BILL_TSQ,
        }),
      ]);
    });

    it('extracts an EKEDC meter token from nested TSQ pin objects', async () => {
      const { checkTransactionStatus } = await import('@/lib/kuda');

      const fetchMock = vi.fn().mockImplementation((url) => {
        if (url.toString().includes('GetToken')) {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve('token'),
          } as Response);
        }

        return mockKudaResponse(
          {
            FinalStatus: 'successful',
            Pin: {
              Number: '  TEST-EKEDC-TOKEN-ALPHA  ',
              Units: '29.4',
            },
          },
          'Token found'
        );
      });
      globalThis.fetch = fetchMock;

      const result = await checkTransactionStatus('kuda-bill-1', 'VTU-123');

      expect(result).toEqual({
        message: 'Token found',
        pin: 'TEST-EKEDC-TOKEN-ALPHA',
        status: 'successful',
      });
    });

    it('does not treat scalar TSQ data as a voucher token', async () => {
      const { checkTransactionStatus } = await import('@/lib/kuda');

      const fetchMock = vi.fn().mockImplementation((url) => {
        if (url.toString().includes('GetToken')) {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve('token'),
          } as Response);
        }

        return mockKudaResponse('Pending', 'Scalar status payload');
      });
      globalThis.fetch = fetchMock;

      const result = await checkTransactionStatus('kuda-bill-1');

      expect(result).toEqual({
        message: 'Scalar status payload',
        status: 'unknown',
      });
    });

    it('logs fixed Kuda metadata without response payloads when bill debug is enabled', async () => {
      // Codex R98 P1: redacting selected keys did not satisfy the VTU
      // exception's absolute ban on provider response bodies in logs —
      // the marker carries routing metadata only.
      vi.stubEnv('KUDA_BILL_DEBUG', '1');
      const { checkTransactionStatus } = await import('@/lib/kuda');
      const consoleInfoSpy = vi
        .spyOn(console, 'info')
        .mockImplementation(() => undefined);
      const meterNumber = '43901766923';
      const phoneNumber = '08146978921';
      const tokenValue = 'TEST-EKEDC-TOKEN-ALPHA';

      const fetchMock = vi.fn().mockImplementation((url) => {
        if (url.toString().includes('GetToken')) {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve('token'),
          } as Response);
        }

        return mockKudaResponse(
          {
            FinalStatus: 'successful',
            Pin: {
              Number: tokenValue,
              Units: '29.4',
            },
            CustomerIdentifier: meterNumber,
            PhoneNumber: phoneNumber,
          },
          'Token found'
        );
      });
      globalThis.fetch = fetchMock;

      try {
        await checkTransactionStatus('kuda-bill-1');

        const payload = consoleInfoSpy.mock.calls.find((call) =>
          String(call[0]).includes('Kuda response received')
        )?.[1] as Record<string, unknown> | undefined;
        expect(payload).toEqual({
          message: 'Kuda response received',
          requestRef: expect.any(String),
          serviceType: KudaServiceType.BILL_TSQ,
        });
        const serializedPayload = JSON.stringify(payload);
        expect(serializedPayload).not.toContain(tokenValue);
        expect(serializedPayload).not.toContain(meterNumber);
        expect(serializedPayload).not.toContain(phoneNumber);
      } finally {
        consoleInfoSpy.mockRestore();
      }
    });

    it('returns the highest-priority observed status when no token is found', async () => {
      const { checkTransactionStatus } = await import('@/lib/kuda');

      const fetchMock = vi.fn().mockImplementation((url, options) => {
        if (url.toString().includes('GetToken')) {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve('token'),
          } as Response);
        }

        const payload = JSON.parse(String(options?.body));
        if (payload.Data.BillResponseReference) {
          return mockKudaResponse({ finalStatus: 'failed' }, 'Failed');
        }

        return mockKudaResponse({ FinalStatus: 'processing' }, 'Processing');
      });
      globalThis.fetch = fetchMock;

      const result = await checkTransactionStatus('kuda-bill-1', 'VTU-123');

      expect(result).toEqual({
        message: 'Processing',
        status: 'pending',
      });
    });

    it('maps numeric Kuda transactionStatus values to provider statuses', async () => {
      const { checkTransactionStatus } = await import('@/lib/kuda');

      const fetchMock = vi.fn().mockImplementation((url) => {
        if (url.toString().includes('GetToken')) {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve('token'),
          } as Response);
        }

        return mockKudaResponse({ transactionStatus: 2 }, 'Failed');
      });
      globalThis.fetch = fetchMock;

      const result = await checkTransactionStatus('kuda-bill-1');

      expect(result).toEqual({
        message: 'Failed',
        status: 'failed',
      });
    });

    it('maps capitalized finalStatus failures before numeric transactionStatus fallback', async () => {
      const { checkTransactionStatus } = await import('@/lib/kuda');

      const fetchMock = vi.fn().mockImplementation((url) => {
        if (url.toString().includes('GetToken')) {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve('token'),
          } as Response);
        }

        return mockKudaResponse(
          { finalStatus: 'Failed', transactionStatus: 3 },
          'Failed'
        );
      });
      globalThis.fetch = fetchMock;

      const result = await checkTransactionStatus('kuda-bill-1');

      expect(result).toEqual({
        message: 'Failed',
        status: 'failed',
      });
    });

    it('throws all reference query errors when every status query fails', async () => {
      const { checkTransactionStatus } = await import('@/lib/kuda');

      const responseRefError = new Error('response reference failed');
      const requestRefError = new Error('request reference failed');
      const fetchMock = vi.fn().mockImplementation((url, options) => {
        if (url.toString().includes('GetToken')) {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve('token'),
          } as Response);
        }

        const payload = JSON.parse(String(options?.body));
        if (payload.Data.BillResponseReference) {
          return Promise.reject(responseRefError);
        }

        return Promise.reject(requestRefError);
      });
      globalThis.fetch = fetchMock;

      await expect(
        checkTransactionStatus('kuda-bill-1', 'VTU-123')
      ).rejects.toMatchObject({
        errors: [responseRefError, requestRefError],
        message: 'All Kuda transaction status queries failed',
      });
    });
  });

  describe('getBillersByType', () => {
    it('maps Kuda electricity bill items that use kudaIdentifier and name fields', async () => {
      const { getBillersByType } = await import('@/lib/kuda');

      const fetchMock = vi.fn().mockImplementation((url) => {
        if (url.toString().includes('GetToken')) {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve('token'),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              status: true,
              message: 'Operation successful',
              data: {
                billers: [
                  {
                    id: 'ekedc',
                    name: 'EKEDC NG',
                    description: 'Electricity',
                    billTypeId: 'electricity',
                    billItems: [
                      {
                        id: '2e38a937-842c-4f92-aaaa-3e2f16919060',
                        name: 'EKEDC PREPAID',
                        kudaIdentifier: 'KUD-ELE-EKED-002',
                        amount: 0,
                        isFixedPrice: false,
                        billerId: 'ekedc',
                      },
                      {
                        id: '9daaa91b-0177-4de4-ba3b-9c86f14848ed',
                        name: 'EKEDC POSTPAID',
                        kudaIdentifier: 'KUD-ELE-EKED-001',
                        amount: 0,
                        isFixedPrice: false,
                        billerId: 'ekedc',
                      },
                    ],
                  },
                ],
              },
            }),
        } as Response);
      });

      globalThis.fetch = fetchMock;

      const result = await getBillersByType('Electricity');

      expect(result[0].billItems).toEqual([
        expect.objectContaining({
          itemCode: 'KUD-ELE-EKED-002',
          itemName: 'EKEDC PREPAID',
          isAmountFixed: false,
        }),
        expect.objectContaining({
          itemCode: 'KUD-ELE-EKED-001',
          itemName: 'EKEDC POSTPAID',
          isAmountFixed: false,
        }),
      ]);
    });

    it('preserves nested bill items from the provider response', async () => {
      const { getBillersByType } = await import('@/lib/kuda');

      const fetchMock = vi.fn().mockImplementation((url) => {
        if (url.toString().includes('GetToken')) {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve('token'),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              status: true,
              message: 'Operation successful',
              data: {
                billers: [
                  {
                    id: 'ekedc',
                    name: 'EKEDC NG',
                    description: 'Electricity',
                    billTypeId: 'electricity',
                    billItems: [
                      {
                        itemCode: 'prepaid',
                        itemName: 'Prepaid',
                        amount: 0,
                        itemCurrencySymbol: 'NGN',
                        isAmountFixed: false,
                        itemFee: 0,
                        billItems: [
                          {
                            itemCode: 'residential',
                            itemName: 'Residential',
                            amount: 0,
                            itemCurrencySymbol: 'NGN',
                            isAmountFixed: false,
                            itemFee: 0,
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            }),
        } as Response);
      });

      globalThis.fetch = fetchMock;

      const result = await getBillersByType('Electricity');

      expect(result).toEqual([
        expect.objectContaining({
          billerId: 'ekedc',
          billItems: [
            expect.objectContaining({
              itemCode: 'prepaid',
              billItems: [
                expect.objectContaining({
                  itemCode: 'residential',
                }),
              ],
            }),
          ],
        }),
      ]);
    });
  });

  describe('isKudaVendSuccessful', () => {
    it('returns false immediately when the envelope status is false', async () => {
      const { isKudaVendSuccessful } = await import('./kuda');
      expect(isKudaVendSuccessful(false, { finalStatus: 'Successful' })).toBe(
        false
      );
    });

    it('falls back to the envelope when both finalStatus and transactionStatus are absent', async () => {
      const { isKudaVendSuccessful } = await import('./kuda');
      expect(isKudaVendSuccessful(true, undefined)).toBe(true);
      expect(isKudaVendSuccessful(true, {})).toBe(true);
      expect(isKudaVendSuccessful(true, { message: 'no statuses' })).toBe(true);
    });

    it('treats finalStatus="Successful" as success regardless of casing', async () => {
      const { isKudaVendSuccessful } = await import('./kuda');
      expect(isKudaVendSuccessful(true, { finalStatus: 'Successful' })).toBe(
        true
      );
      expect(isKudaVendSuccessful(true, { finalStatus: 'SUCCESS' })).toBe(true);
      expect(isKudaVendSuccessful(true, { finalStatus: 'completed' })).toBe(
        true
      );
      expect(isKudaVendSuccessful(true, { FinalStatus: 'Complete' })).toBe(
        true
      );
    });

    it('returns false for non-success finalStatus values, including non-terminal ones', async () => {
      const { isKudaVendSuccessful } = await import('./kuda');
      expect(isKudaVendSuccessful(true, { finalStatus: 'Failed' })).toBe(false);
      expect(isKudaVendSuccessful(true, { finalStatus: 'Pending' })).toBe(
        false
      );
      expect(isKudaVendSuccessful(true, { finalStatus: 'Processing' })).toBe(
        false
      );
      expect(isKudaVendSuccessful(true, { finalStatus: 'In Progress' })).toBe(
        false
      );
      // Unknown new code Kuda might add: must not be silently treated as success.
      expect(isKudaVendSuccessful(true, { finalStatus: 'k99-something' })).toBe(
        false
      );
    });

    it('does not fall through to transactionStatus when finalStatus is set', async () => {
      const { isKudaVendSuccessful } = await import('./kuda');
      // finalStatus says Pending; transactionStatus 3 would otherwise mean
      // success. The presence of finalStatus must short-circuit.
      expect(
        isKudaVendSuccessful(true, {
          finalStatus: 'Pending',
          transactionStatus: 3,
        })
      ).toBe(false);
    });

    it('treats transactionStatus="3" as success when finalStatus is absent', async () => {
      const { isKudaVendSuccessful } = await import('./kuda');
      expect(isKudaVendSuccessful(true, { transactionStatus: 3 })).toBe(true);
      expect(isKudaVendSuccessful(true, { transactionStatus: '3' })).toBe(true);
      expect(isKudaVendSuccessful(true, { TransactionStatus: 3 })).toBe(true);
    });

    it('returns false for transactionStatus values other than 3', async () => {
      const { isKudaVendSuccessful } = await import('./kuda');
      expect(isKudaVendSuccessful(true, { transactionStatus: 2 })).toBe(false); // Failed
      expect(isKudaVendSuccessful(true, { transactionStatus: 1 })).toBe(false); // Pending
      expect(isKudaVendSuccessful(true, { transactionStatus: 0 })).toBe(false);
      expect(isKudaVendSuccessful(true, { transactionStatus: 'unknown' })).toBe(
        false
      );
    });
  });

  describe('extractKudaVoucherPin', () => {
    it('returns undefined for missing or empty data', async () => {
      const { extractKudaVoucherPin } = await import('./kuda');
      expect(extractKudaVoucherPin(undefined)).toBeUndefined();
      expect(extractKudaVoucherPin({})).toBeUndefined();
      expect(extractKudaVoucherPin({ pin: null })).toBeUndefined();
    });

    it('extracts a string pin (legacy airtime/data shape)', async () => {
      const { extractKudaVoucherPin } = await import('./kuda');
      expect(extractKudaVoucherPin({ pin: '1234-5678' })).toBe('1234-5678');
      expect(extractKudaVoucherPin({ Pin: '   abc   ' })).toBe('abc');
    });

    it('extracts the .number from the nested object pin (electricity shape)', async () => {
      const { extractKudaVoucherPin } = await import('./kuda');
      expect(
        extractKudaVoucherPin({
          pin: {
            number: 'TEST-EKEDC-TOKEN-BETA',
            serial: null,
            instructions: null,
          },
        })
      ).toBe('TEST-EKEDC-TOKEN-BETA');
    });

    it('coerces numeric pins to strings', async () => {
      const { extractKudaVoucherPin } = await import('./kuda');
      expect(extractKudaVoucherPin({ pin: 12345678 })).toBe('12345678');
      expect(extractKudaVoucherPin({ pin: { number: 87654321 } })).toBe(
        '87654321'
      );
    });

    it('falls through to alternative token field names', async () => {
      const { extractKudaVoucherPin } = await import('./kuda');
      expect(extractKudaVoucherPin({ Token: '999' })).toBe('999');
      expect(extractKudaVoucherPin({ meterToken: { number: '111' } })).toBe(
        '111'
      );
      expect(extractKudaVoucherPin({ vendCode: '222' })).toBe('222');
      expect(extractKudaVoucherPin({ Voucher: { number: '333' } })).toBe('333');
    });

    it('skips empty object pins (failed vend) and falls through', async () => {
      const { extractKudaVoucherPin } = await import('./kuda');
      expect(
        extractKudaVoucherPin({
          pin: { number: null, serial: null, instructions: null },
          token: 'fallback-token',
        })
      ).toBe('fallback-token');
    });

    it('skips whitespace-only pin values', async () => {
      const { extractKudaVoucherPin } = await import('./kuda');
      expect(
        extractKudaVoucherPin({
          pin: { number: '   ' },
          Token: 'real-token',
        })
      ).toBe('real-token');
    });
  });

  describe('buildKudaVendMessage', () => {
    it('uses the supplied fallback when no biller status is present', async () => {
      const { buildKudaVendMessage } = await import('./kuda');
      expect(buildKudaVendMessage('Insufficient balance', undefined)).toBe(
        'Insufficient balance'
      );
      expect(buildKudaVendMessage('Insufficient balance', {})).toBe(
        'Insufficient balance'
      );
    });

    it('appends billerAggregatorStatus to surface the upstream reject code', async () => {
      const { buildKudaVendMessage } = await import('./kuda');
      expect(
        buildKudaVendMessage('Vend rejected', {
          billerAggregatorStatus: 'k11',
        })
      ).toBe('Vend rejected (biller status: k11)');
    });

    it('falls back to a default message when the fallback is empty or whitespace', async () => {
      const { buildKudaVendMessage } = await import('./kuda');
      expect(buildKudaVendMessage('', { billerAggregatorStatus: 'k11' })).toBe(
        'Purchase failed (biller status: k11)'
      );
      expect(
        buildKudaVendMessage('   ', { billerAggregatorStatus: 'k11' })
      ).toBe('Purchase failed (biller status: k11)');
      expect(buildKudaVendMessage(undefined, undefined)).toBe(
        'Purchase failed'
      );
    });

    it('reads billerAggregatorStatus from either casing', async () => {
      const { buildKudaVendMessage } = await import('./kuda');
      expect(
        buildKudaVendMessage('Vend rejected', {
          BillerAggregatorStatus: 'k99',
        })
      ).toBe('Vend rejected (biller status: k99)');
    });
  });
});
