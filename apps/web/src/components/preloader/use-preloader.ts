"use client";

import { useSpring } from "@react-spring/web";
import { useEffect, useState } from "react";

import { useScroll } from "@/hooks/smooth-scroll/use-scroll";

/**
 * Loading progress for the preloader: real image loading blended
 * with a minimum run time, so even a cached page shows the whole animation.
 * `progress` is a spring (0→1); `done` flips once it reaches 1; `gone` after
 * the exit animation (`exitMs`) so the overlay can unmount.
 */
export const usePreloader = ({
  minMs = 1500,
  exitMs = 750,
  stops = [],
}: {
  minMs?: number;
  exitMs?: number;
  /**
   * Progress values the overlay reacts to (a card landing). `target` — the
   * React state — changes only when one is crossed and at 1; the counter and
   * the bar follow every frame through the spring, outside React. Re-rendering
   * the overlay on every frame of the run was ~180 renders (each one
   * restarting the cards' springs) on the main thread while the page loads.
   */
  stops?: readonly number[];
} = {}) => {
  const [target, setTarget] = useState(0);
  const [done, setDone] = useState(false);
  const [gone, setGone] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [{ progress }, api] = useSpring(() => ({ progress: 0, config: { tension: 480, friction: 52 } }));
  const stop = useScroll((s) => s.stop);
  const start = useScroll((s) => s.start);

  useEffect(() => {
    setMounted(true);
    stop();
    const t0 = performance.now();
    let last = 0;
    let raf = 0;
    const tick = () => {
      // Lazy images below the fold never load while scroll is locked — count
      // eager ones only, and give up waiting after 2× the minimum run time.
      const imgs = Array.from(document.images).filter((i) => i.loading !== "lazy");
      const loaded = imgs.length ? imgs.filter((i) => i.complete).length / imgs.length : 1;
      const elapsed = performance.now() - t0;
      const time = Math.min(1, elapsed / minMs);
      const next = elapsed > minMs * 2 ? 1 : Math.min(time, 0.15 + loaded * 0.85);
      api.start({ progress: next });
      if (next >= 1 || stops.some((at) => at > last && at <= next)) {
        last = next;
        setTarget(next);
      }
      if (next >= 1) return;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [minMs, stop, api, stops]);

  useEffect(() => {
    if (target < 1 || done) return;
    const t = window.setTimeout(() => setDone(true), 175);
    return () => window.clearTimeout(t);
  }, [target, done]);

  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => {
      setGone(true);
      start();
    }, exitMs);
    return () => window.clearTimeout(t);
  }, [done, exitMs, start]);

  return { progress, target, done, gone, mounted };
};

/** 0→1 progress as a zero-padded counter ("000"…"100"). */
export const toCounter = (v: number) => String(Math.round(v * 100)).padStart(3, "0");
