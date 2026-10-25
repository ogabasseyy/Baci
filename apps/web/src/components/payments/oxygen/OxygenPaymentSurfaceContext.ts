'use client';
import { createContext, type Dispatch, type SetStateAction } from 'react';
export const OxygenPaymentSurfaceContext = createContext<Dispatch<
  SetStateAction<string | null>
> | null>(null);

export const OxygenSelfieSurfaceContext = createContext<
  ((url: string, workflowId?: string) => void) | null
>(null);

export const OxygenPaymentOpenContext = createContext(false);

export const OxygenCheckoutCloseContext = createContext<
  (() => void) | undefined
>(undefined);

export const OxygenSelfieConfirmedContext = createContext<string | null>(null);
