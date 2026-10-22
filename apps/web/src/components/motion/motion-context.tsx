"use client";

import { createContext, useContext } from "react";

export interface MotionState {
  /** Bumped on a layout-range change — remounts every slot so it replays. */
  replay: number;
  /**
   * Runs `fn` once the preloader has lifted (at once if it already has, or
   * there is none); returns an unsubscribe. A subscription, not a `ready`
   * flag: flipping a context value re-rendered every slot on the page (~150)
   * in one task as the curtain lifted — now only the slots' effects hear it.
   */
  onReady: (fn: () => void) => () => void;
  /** Called by the preloader as it starts to lift. */
  release: () => void;
}

export const MotionContext = createContext<MotionState | null>(null);

/** `null` outside `SiteMotion` — slots then render plain, static markup. */
export const useMotion = () => useContext(MotionContext);
