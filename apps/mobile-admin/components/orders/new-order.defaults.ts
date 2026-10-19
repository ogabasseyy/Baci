import type {
  CustomerInfo,
  CustomItemDraft,
  DeliveryInfo,
  NewCustomerDraft,
} from './new-order.types';

export function createEmptyCustomerInfo(): CustomerInfo {
  return {
    address: '',
    email: '',
    id: null,
    name: '',
    phone: '',
    city: '',
    state: '',
    country: '',
    countryCode: '',
    postalCode: '',
  };
}

export function createEmptyCustomItemDraft(): CustomItemDraft {
  return {
    name: '',
    price: '',
  };
}

export function createEmptyDeliveryInfo(): DeliveryInfo {
  return {
    address: '',
    city: '',
    name: '',
    phone: '',
    state: '',
    country: '',
    countryCode: '',
    postalCode: '',
  };
}

export function createEmptyNewCustomerDraft(): NewCustomerDraft {
  return {
    address: '',
    city: '',
    state: '',
    country: '',
    countryCode: '',
    postalCode: '',
    companyName: '',
    customerType: 'individual',
    email: '',
    firstName: '',
    lastName: '',
    phone: '',
  };
}
