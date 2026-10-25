'use client';
import { useContext } from 'react';
import { OxygenSelfieSurfaceContext } from './OxygenPaymentSurfaceContext';
import { oxygenButtonClass } from './oxygen-checkout-styles';

export function OxygenSelfieButton({
  url,
  workflowId,
}: {
  url: string;
  workflowId?: string;
}) {
  const open = useContext(OxygenSelfieSurfaceContext);
  if (!open)
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={oxygenButtonClass}
      >
        Continue to selfie verification
      </a>
    );
  return (
    <button
      type="button"
      className={`${oxygenButtonClass} w-full`}
      onClick={() => open(url, workflowId)}
    >
      Continue to selfie verification
    </button>
  );
}
