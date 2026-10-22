"use client";

import { Suspense, use, useEffect, useId, type ReactNode } from "react";

/**
 * Hydrate a server-rendered block in an idle period of its own — not in the
 * page's one big hydration commit (from kimi; the pipeline's Fix Catalog).
 *
 * Hydrating the whole page at once was one long task on a 4×-throttled phone
 * (kimi ~670 ms; held-mint ~0.5 s — every reveal and parallax spring). Each
 * wrapped block suspends while React hydrates, React keeps its server HTML on
 * screen, and the block hydrates in place (no remount) when its turn in the
 * queue comes: one block per idle period, in page order.
 *
 * Why idle and not "on approach": opening a block as the visitor scrolls
 * toward it put its hydration commit under the swipe — a 75–100 ms frame in
 * the phone scroll test, every run (kimi). On held-mint the queue drains under
 * the preloader, before anyone can see or touch the page.
 *
 * On the server the gate is open; a client mount that is not hydration waits
 * one idle period.
 */
/**
 * Each block waits at most this long for an idle period. The queue must drain
 * while the preloader still covers the page: a block that is not hydrated
 * when the visitor first touches it is hydrated by React synchronously, in
 * that touch (held-mint: a 168 ms frame on the first swipe with kimi's 3 s —
 * nine blocks × 3 s outlasted the 3 s curtain under its own animation).
 */
const IDLE_TIMEOUT = 400;

const queue: { id: string; open: () => void }[] = [];
let draining = false;

const whenIdle = (run: () => void) => {
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(run, { timeout: IDLE_TIMEOUT });
  } else {
    setTimeout(run, 120);
  }
};

/**
 * The next gate opens only after the previous block has committed (its
 * `Hydrated` effect) and the thread has been idle again. Opening them on a
 * timer let several gates open before React rendered, and React hydrated the
 * retried boundaries together — one 270–380 ms task on PageSpeed's machines
 * (held-mint) instead of one short task per block.
 */
let waitingFor: string | null = null;
let fallback = 0;

const drain = () => {
  const next = queue.shift();
  if (!next) {
    draining = false;
    waitingFor = null;
    return;
  }
  whenIdle(() => {
    waitingFor = next.id;
    next.open();
    // A block that never commits (unmounted meanwhile) must not stall the rest.
    window.clearTimeout(fallback);
    fallback = window.setTimeout(drain, 1000);
  });
};

const hydrated = (id: string) => {
  if (waitingFor !== id) return;
  waitingFor = null;
  window.clearTimeout(fallback);
  drain();
};

const enqueue = (id: string, open: () => void) => {
  queue.push({ id, open });
  if (draining) return;
  draining = true;
  // From the first idle period after hydration, not from `load`: the header
  // and hero are in the queue too and must be live before the curtain lifts —
  // `load` waits for the eager images, seconds on a slow phone.
  drain();
};

/** `useId` is stable across the server render, hydration and its retries. */
const gates = new Map<string, Promise<void>>();

/** Renders nothing; its effect runs once the block around it has committed. */
const Hydrated = ({ id }: { id: string }) => {
  useEffect(() => hydrated(id), [id]);
  return null;
};

const Gate = ({ id, children }: { id: string; children: ReactNode }) => {
  if (typeof window !== "undefined") {
    let gate = gates.get(id);
    if (!gate) {
      gate = new Promise<void>((open) => enqueue(id, open));
      gates.set(id, gate);
    }
    use(gate);
  }
  return (
    <>
      {children}
      <Hydrated id={id} />
    </>
  );
};

export const HydrateWhenIdle = ({ children }: { children: ReactNode }) => {
  const id = useId();
  return (
    <Suspense>
      <Gate id={id}>{children}</Gate>
    </Suspense>
  );
};
