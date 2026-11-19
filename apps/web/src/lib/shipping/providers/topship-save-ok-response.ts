import { ProviderBookingTimeoutError } from '../provider-booking-timeout-error';

/**
 * Reads and parses an HTTP 2xx save-shipment answer. Topship may already have
 * created the shipment, so a body that cannot be read or parsed is an
 * unconfirmed provider call (the booking lock stays), not an unexpected error.
 */
export async function readOkSaveResponse<TBody, TShipment>(
  response: Response,
  readBody: (response: Response) => Promise<TBody>,
  parse: (body: TBody) => TShipment
): Promise<TShipment> {
  try {
    return parse(await readBody(response));
  } catch {
    throw new ProviderBookingTimeoutError(
      'Topship returned an unreadable save-shipment response'
    );
  }
}
