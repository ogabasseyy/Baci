import { useState } from 'react';

export function useWalletDiscoveryBubbleVisibility(enabled: boolean) {
  const [visible, setVisible] = useState(false);
  const [wasEnabled, setWasEnabled] = useState(enabled);

  if (wasEnabled !== enabled) {
    setWasEnabled(enabled);
    setVisible(false);
  }

  const onVisibilityChange = (nextVisible: boolean) => {
    if (enabled) {
      setVisible(nextVisible);
    }
  };

  return {
    reserveTouchSpace: enabled && visible,
    onVisibilityChange,
  };
}
