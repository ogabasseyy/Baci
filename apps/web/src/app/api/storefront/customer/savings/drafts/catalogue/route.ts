import type { NextRequest } from 'next/server';
import { handleCustomerSavingsCatalogue } from '@/lib/customer-savings-catalogue-handler';

export function GET(request: NextRequest) {
  return handleCustomerSavingsCatalogue(request);
}
