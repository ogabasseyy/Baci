'use client';
import { createContext, type Dispatch, type SetStateAction } from 'react';
import type { OxygenSelfieRenewHandler } from './use-oxygen-selfie-renewal-bridge';
export const OxygenPaymentSurfaceContext = createContext<Dispatch<
  SetStateAction<string | null>
> | null>(null);

export const OxygenSelfieSurfaceContext = createContext<
  ((url: string, workflowId?: string) => void) | null
>(null);

export const OxygenHostedOriginsContext = createContext<readonly string[]>([]);

export const OxygenPaymentOpenContext = createContext(false);

export const OxygenCheckoutCloseContext = createContext<
  (() => void) | undefined
>(undefined);

export const OxygenSelfieConfirmedContext = createContext<string | null>(null);

export const OxygenOrderConfirmationContext = createContext<
  (() => void) | undefined
>(undefined);

export const OxygenSelfieRenewalContext = createContext<
  ((handler: OxygenSelfieRenewHandler) => () => void) | null
>(null);

export const OxygenSelfieOpenContext = createContext(false);

export const OxygenSelfieDismissedContext = createContext(false);
