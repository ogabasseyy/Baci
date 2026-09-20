/**
 * Drawer Store
 * Manages the navigation drawer open/close state
 */

import { create } from 'zustand';

interface DrawerState {
  isOpen: boolean;
  /**
   * True only while the drawer is fully open. isOpen flips when an animation
   * starts, so ad ownership keys off this latch instead: the drawer slot
   * mounts after the open animation completes and background slots resume
   * only after the close animation completes.
   */
  isFullyOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
  setFullyOpen: (fullyOpen: boolean) => void;
}

export const useDrawerStore = create<DrawerState>((set) => ({
  isOpen: false,
  isFullyOpen: false,
  openDrawer: () => set({ isOpen: true }),
  closeDrawer: () => set({ isOpen: false }),
  toggleDrawer: () => set((state) => ({ isOpen: !state.isOpen })),
  setFullyOpen: (fullyOpen: boolean) => set({ isFullyOpen: fullyOpen }),
}));
