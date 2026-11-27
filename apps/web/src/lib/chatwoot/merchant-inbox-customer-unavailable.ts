/**
 * The store's customer or order records could not be read. Not the same as
 * "no customer": callers answer unavailable instead of an empty card or list.
 */
export class MerchantInboxCustomerUnavailableError extends Error {
  constructor() {
    super('Customer records are temporarily unavailable');
    this.name = 'MerchantInboxCustomerUnavailableError';
  }
}
