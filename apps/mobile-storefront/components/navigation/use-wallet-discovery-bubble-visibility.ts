import { useState } from 'react';

export function useWalletDiscoveryBubbleVisibility(enabled: boolean) {
  const [visible, setVisible] = useState(false);

  return {
    reserveTouchSpace: enabled && visible,
    onVisibilityChange: setVisible,
  };
}
