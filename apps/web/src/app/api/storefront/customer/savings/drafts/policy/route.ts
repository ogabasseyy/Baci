import type { NextRequest } from 'next/server';
import { handleCustomerSavingsDraft } from '@/lib/customer-savings-draft-handler';

export function GET(request: NextRequest) {
  return handleCustomerSavingsDraft(request, 'policy');
}

export function POST(request: NextRequest) {
  return handleCustomerSavingsDraft(request, 'accept');
}
