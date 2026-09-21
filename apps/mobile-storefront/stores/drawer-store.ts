/**
 * Drawer Store
 * Manages the navigation drawer open/close state
 */

import { create } from 'zustand';

interface DrawerState {
  isOpen: boolean;
  /**
   * True only while the drawer is fully open. The drawer slot mounts on
   * this latch so it never requests while sliding in from off-screen.
   */
  isFullyOpen: boolean;
  /**
   * True from open-start through close-complete, including an opening that
   * is interrupted by a close. Background slots suspend on this latch so
   * they never request beneath a visibly animating drawer.
   */
  isCovering: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
  setFullyOpen: (fullyOpen: boolean) => void;
  setCovering: (covering: boolean) => void;
}

export const useDrawerStore = create<DrawerState>((set) => ({
  isOpen: false,
  isFullyOpen: false,
  isCovering: false,
  openDrawer: () => set({ isOpen: true }),
  closeDrawer: () => set({ isOpen: false }),
  toggleDrawer: () => set((state) => ({ isOpen: !state.isOpen })),
  setFullyOpen: (fullyOpen: boolean) => set({ isFullyOpen: fullyOpen }),
  setCovering: (covering: boolean) => set({ isCovering: covering }),
}));
