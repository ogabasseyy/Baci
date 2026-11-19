/** A GIG-shaped decrypted status event, with per-test overrides. */
export function giglWebhookEventJson(
  overrides: Record<string, unknown> = {}
): string {
  return JSON.stringify({
    Waybill: '1349639673',
    SenderAddress: '1 Sender Street, Lagos',
    ReceiverAddress: '2 Receiver Road, Abakaliki',
    Location: null,
    Status: 'SHIPMENT CREATED BY CUSTOMER',
    UserId: 'a1b2c3d4-0000-4000-8000-000000000001',
    ChannelCode: 'IND000001',
    StatusCode: 'MCRT',
    ...overrides,
  });
}
