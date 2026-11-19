import type { NextRequest } from 'next/server';
import { handlePrimaryProvisioning } from './handle-primary-provisioning';

export const POST = (request: NextRequest) =>
  handlePrimaryProvisioning(request, 'provision');
export const PATCH = (request: NextRequest) =>
  handlePrimaryProvisioning(request, 'recover');
