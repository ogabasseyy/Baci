'use client';

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@ui-sdk/react/dialog';
import Link from 'next/link';
import { asRoute } from '@/lib/routes';

interface OwnershipDialogProps {
  basePath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalFocus: () => HTMLButtonElement | null;
}

export function OwnershipDialog({
  basePath,
  open,
  onOpenChange,
  finalFocus,
}: OwnershipDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="oga-access oa-dialog"
        initialFocus="content"
        finalFocus={finalFocus}
      >
        <div className="oa-dialog-heading">
          <span className="oa-kicker">Your budget. Your choice.</span>
          <DialogClose className="oa-circle" aria-label="Close comparison">
            <span aria-hidden="true">×</span>
          </DialogClose>
        </div>
        <DialogTitle>Find your way to your next device.</DialogTitle>
        <DialogDescription>
          Compare the starting point and when you get your device.
        </DialogDescription>
        <div className="oa-dialog-options">
          <article>
            <h3>Buy outright</h3>
            <p>
              Pay the full price at checkout. Choose from new and premium
              pre-owned devices.
            </p>
            <Link href={asRoute(`${basePath}/products`)} prefetch={false}>
              Browse devices ↗
            </Link>
          </article>
          <article>
            <h3>Pay over time</h3>
            <p>
              Pay 25–40% upfront on an approved plan, get your device, then
              spread the balance over 3–6 months.
            </p>
            <Link href={asRoute(`${basePath}/contact`)} prefetch={false}>
              Ask about payment plans ↗
            </Link>
          </article>
          <article>
            <h3>Save first</h3>
            <p>
              Build your device fund before buying. Eligible savings plans earn
              interest; availability and terms apply.
            </p>
            <Link href={asRoute(`${basePath}/wallet`)} prefetch={false}>
              See your wallet options ↗
            </Link>
          </article>
        </div>
        <p className="oa-fineprint">
          Payment plans require eligibility and provider approval. Check your
          offer for fees and total repayment. Check savings rates and withdrawal
          terms before saving.
        </p>
        <DialogClose className="oa-button">Back to exploring</DialogClose>
      </DialogContent>
    </Dialog>
  );
}
