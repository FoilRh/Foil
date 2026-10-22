"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { MotionContext } from "./motion-context";

/** The layout ranges of globals.css (desktop / laptop / tablet / mobile). */
const RANGES = ["(width >= 1200px)", "(896px <= width < 1200px)", "(700px <= width < 896px)", "(width < 700px)"];

/**
 * Plays the home page's motion set (`MOTION`). Crossing into
 * another layout range (resizing the window, rotating a tablet) replays every
 * reveal for the new layout — on screen at once, the rest as it scrolls in.
 */
export const SiteMotion = ({ children, gated = false }: { children: ReactNode; gated?: boolean }) => {
  const [replay, setReplay] = useState(0);
  // With a preloader (`gated`) nothing reveals until it calls `release`.
  const ready = useRef(!gated);
  const waiting = useRef(new Set<() => void>());
  const release = useCallback(() => {
    if (ready.current) return;
    ready.current = true;
    waiting.current.forEach((fn) => fn());
    waiting.current.clear();
  }, []);
  const onReady = useCallback((fn: () => void) => {
    if (ready.current) {
      fn();
      return () => {};
    }
    const set = waiting.current;
    set.add(fn);
    return () => {
      set.delete(fn);
    };
  }, []);
  useEffect(() => {
    const queries = RANGES.map((q) => window.matchMedia(q));
    const onChange = (e: MediaQueryListEvent) => e.matches && setReplay((n) => n + 1);
    queries.forEach((q) => q.addEventListener("change", onChange));
    return () => queries.forEach((q) => q.removeEventListener("change", onChange));
  }, []);
  const state = useMemo(() => ({ replay, onReady, release }), [replay, onReady, release]);
  return <MotionContext.Provider value={state}>{children}</MotionContext.Provider>;
};
