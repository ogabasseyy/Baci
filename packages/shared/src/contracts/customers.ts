export const CUSTOMER_ADMIN_COLUMNS =
  'id, merchant_id, customer_type, company_name, full_name, first_name, last_name, email, phone, address, city, state, zip_code, country, country_code, latitude, longitude, store_credit, total_orders, total_spent, loyalty_points, created_at, updated_at, last_login_at, deleted_at';

export type CustomerType = 'individual' | 'company';

export type CustomerNameFields = {
  company_name?: string | null;
  customer_type?: string | null;
  email?: string | null;
  first_name?: string | null;
  full_name?: string | null;
  last_name?: string | null;
};

export type CustomerRecordNameFields = Omit<
  CustomerNameFields,
  'customer_type'
> & {
  customer_type: CustomerType | null;
};

export function normalizeCustomerType(value?: string | null): CustomerType {
  return value === 'company' ? 'company' : 'individual';
}

export function buildCustomerFullName(
  firstName?: string | null,
  lastName?: string | null,
  fallbackFullName?: string | null
): string | null {
  const fullName = [firstName, lastName]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join(' ');

  if (fullName.length > 0) {
    return fullName;
  }

  const trimmedFallback = fallbackFullName?.trim();
  return trimmedFallback ? trimmedFallback : null;
}

export function buildCustomerNameFields(input: CustomerNameFields) {
  const firstName = input.first_name?.trim() || null;
  const lastName = input.last_name?.trim() || null;
  const fullName =
    buildCustomerFullName(firstName, lastName, input.full_name) ||
    input.email?.split('@')[0]?.trim() ||
    null;

  return {
    first_name: firstName,
    last_name: lastName,
    full_name: fullName,
  };
}

/**
 * Build the persisted name columns for a customer record, handling both
 * individual (first/last) and company customers. For companies the name lives
 * in company_name and is mirrored into full_name so existing full_name-based
 * display and search paths keep working without per-call-site branching.
 */
export function buildCustomerRecordNameFields(
  input: CustomerRecordNameFields
): {
  company_name: string | null;
  customer_type: CustomerType;
  first_name: string | null;
  full_name: string | null;
  last_name: string | null;
} {
  const customerType = normalizeCustomerType(input.customer_type);

  if (customerType === 'company') {
    const companyName = input.company_name?.trim() || null;

    return {
      company_name: companyName,
      customer_type: 'company',
      first_name: null,
      full_name: companyName,
      last_name: null,
    };
  }

  return {
    company_name: null,
    customer_type: 'individual',
    ...buildCustomerNameFields(input),
  };
}

export function splitCustomerFullName(fullName: string | null | undefined): {
  first_name: string | null;
  last_name: string | null;
} {
  const trimmedName = fullName?.trim();
  if (!trimmedName) {
    return { first_name: null, last_name: null };
  }

  const [firstName, ...rest] = trimmedName.split(/\s+/);

  return {
    first_name: firstName || null,
    last_name: rest.length > 0 ? rest.join(' ') : null,
  };
}

export function getCustomerDisplayName(customer: CustomerNameFields): string {
  if (normalizeCustomerType(customer.customer_type) === 'company') {
    const companyName = customer.company_name?.trim();
    if (companyName) {
      return companyName;
    }
  }

  return (
    buildCustomerFullName(
      customer.first_name,
      customer.last_name,
      customer.full_name
    ) ||
    customer.email?.split('@')[0]?.trim() ||
    'Guest'
  );
}

function sanitizeCustomerSearchTerm(searchTerm: string): string {
  return searchTerm
    .normalize('NFKC')
    .trim()
    .replace(/[^\p{L}\p{N}\s@-]/gu, '')
    .replace(/\s+/g, ' ')
    .slice(0, 100);
}

export function buildCustomerSearchFilter(searchTerm: string): string {
  const normalizedSearchTerm = sanitizeCustomerSearchTerm(searchTerm);
  if (!normalizedSearchTerm) {
    return 'id.is.null';
  }

  return [
    `full_name.ilike.%${normalizedSearchTerm}%`,
    `company_name.ilike.%${normalizedSearchTerm}%`,
    `first_name.ilike.%${normalizedSearchTerm}%`,
    `last_name.ilike.%${normalizedSearchTerm}%`,
    `email.ilike.%${normalizedSearchTerm}%`,
    `phone.ilike.%${normalizedSearchTerm}%`,
  ].join(',');
}

export function buildCustomerAddressLine(
  ...parts: Array<string | null | undefined>
): string | null {
  const address = parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(', ');

  return address.length > 0 ? address : null;
}
