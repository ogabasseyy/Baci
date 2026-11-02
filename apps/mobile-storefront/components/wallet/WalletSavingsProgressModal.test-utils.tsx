import type { ComponentProps } from 'react';
import { WalletSavingsProgressModal } from './WalletSavingsProgressModal';

type Props = ComponentProps<typeof WalletSavingsProgressModal>;

export function ConfirmedWalletSavingsProgressModal(props: Props) {
  return (
    <WalletSavingsProgressModal
      {...props}
      progressAvailable={props.progressAvailable ?? true}
    />
  );
}
