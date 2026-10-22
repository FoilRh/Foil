"use client";

import { animated, useSpring, useSprings } from "@react-spring/web";
import Image from "next/image";
import { useEffect, useState } from "react";

import { useMotion } from "@/components/motion/motion-context";

import { toCounter, usePreloader } from "./use-preloader";

/**
 * Four cards from the site, back → front (also their landing order). Each sits
 * in a composition box at a position/width given in % of that box — a wide
 * spread on landscape screens, a 2×2 pile on portrait tablets, a zig-zag
 * column on tall phones — and the box is fitted into the stage, so the pile
 * fills the screen's height on any device.
 */
const CARDS = [
  {
    src: "/assets/intro/intro-card-tucked-overlay.png",
    at: 0.05,
        pos: "left-[19.7%] top-[40.8%] w-[28.2%] portrait:left-[30%] portrait:top-[27%] portrait:w-[47%] tall:left-[36%] tall:top-[22%] tall:w-[62%]",
    tilts: { wide: -20, portrait: -12, tall: -10 },
    // This art has white corners baked in — round them like the site does.
    clip: "overflow-hidden rounded-[4.8%/3.6%]",
  },
  { src: "/assets/intro/intro-card-tucked.png", at: 0.3, pos: "left-[58.7%] top-[43.7%] w-[24.6%] portrait:left-[71%] portrait:top-[26%] portrait:w-[41%] tall:left-[68%] tall:top-[40%] tall:w-[52%]", tilts: { wide: 2, portrait: 6, tall: 7 }, clip: "" },
  { src: "/assets/drop/drop-card.png", at: 0.55, pos: "left-[40.2%] top-[68.6%] w-[19.2%] portrait:left-[31%] portrait:top-[71%] portrait:w-[37%] tall:left-[32%] tall:top-[60%] tall:w-[46%]", tilts: { wide: 4, portrait: 4, tall: -4 }, clip: "" },
  { src: "/assets/intro/intro-card-front.png", at: 0.78, pos: "left-[77.1%] top-[53.4%] w-[32.8%] portrait:left-[67%] portrait:top-[68%] portrait:w-[51%] tall:left-[64%] tall:top-[77%] tall:w-[64%]", tilts: { wide: 20, portrait: 12, tall: 10 }, clip: "" },
] as const;

/** The progress values the overlay re-renders at: each card's landing. */
const STOPS = CARDS.map((card) => card.at);

type Layout = "wide" | "portrait" | "tall";

/** Which composition is showing — same media queries as `portrait:` / `tall:`. */
const useLayout = () => {
  const [layout, setLayout] = useState<Layout>("wide");
  useEffect(() => {
    const tall = window.matchMedia("(max-aspect-ratio: 5/8)");
    const portrait = window.matchMedia("(orientation: portrait)");
    const sync = () => setLayout(tall.matches ? "tall" : portrait.matches ? "portrait" : "wide");
    sync();
    tall.addEventListener("change", sync);
    portrait.addEventListener("change", sync);
    return () => {
      tall.removeEventListener("change", sync);
      portrait.removeEventListener("change", sync);
    };
  }, []);
  return layout;
};

/** Same feel as the site's "Шлепок" card reveal: overshooting scale, quick settle. */
const SLAP = { tension: 420, friction: 20 };

/** Delay between the stamp hitting the pile and the screen lifting. */
const LIFT_DELAY = 350;

/**
 * Site preloader — "Pile + stamp": the intro cards slap down onto the table one
 * by one as the page loads, the percentage fills along the bottom; at 100 the
 * blue SEALED stamp hits the pile, then the screen lifts and the page's own
 * reveals start (they wait for it via the motion context).
 */
export const Preloader = () => {
  const { progress, target, done, gone } = usePreloader({ minMs: 1500, exitMs: 750, stops: STOPS });
  const motion = useMotion();
  const release = motion?.release;
  useEffect(() => {
    if (!done || !release) return;
    const t = window.setTimeout(release, LIFT_DELAY);
    return () => window.clearTimeout(t);
  }, [done, release]);
  const layout = useLayout();
  const [cards] = useSprings(
    CARDS.length,
    (i) => {
      const landed = target >= CARDS[i].at;
      const tilt = CARDS[i].tilts[layout];
      return {
        opacity: landed ? 1 : 0,
        transform: landed ? `scale(1) rotate(${tilt}deg)` : `scale(1.6) rotate(${tilt - 10}deg)`,
        config: SLAP,
      };
    },
    [target, layout],
  );
  const stamp = useSpring({
    opacity: done ? 1 : 0,
    transform: done ? "scale(1) rotate(-8deg)" : "scale(2.6) rotate(-24deg)",
    config: { tension: 520, friction: 22 },
  });
  const lift = useSpring({ v: done ? 1 : 0, delay: done ? LIFT_DELAY : 0, config: { tension: 480, friction: 48 } });
  if (gone) return null;

  // Server-rendered, so it is the first paint: mounted after hydration (a
  // portal) it let the page flash on screen before the curtain covered it.
  return (
    <animated.div
      data-preloader
      role="status"
      aria-label="Loading"
      style={{ transform: lift.v.to((v) => `translateY(${-v * 105}%)`) }}
      className="fixed inset-0 z-[70] flex flex-col overflow-hidden bg-background px-[5vw] py-(--edge) [--edge:max(4.5svh,18px)]"
    >
      {/* While the curtain is up the page can't scroll under it — from the
          server HTML on, before hydration (usePreloader's Lenis stop takes over
          after). A style that leaves with the curtain, not `html:has(...)`: a
          `:has()` on the root is re-checked as the page's DOM changes. */}
      <style>{"html{overflow:hidden}"}</style>
      {/* Without JavaScript nothing would ever lift the curtain: show the page. */}
      <noscript>
        <style>{"[data-preloader]{display:none!important}html{overflow:auto!important}"}</style>
      </noscript>

      {/* The page's own grain texture. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[url(/assets/shared/texture-grain.webp)] bg-size-[--spacing(128)] opacity-20 mix-blend-screen"
      />

      {/* Caption sits as far from the top as the progress bar from the bottom (--edge). */}
      <p className="type-script relative shrink-0 self-center text-[clamp(18px,3.4vmin,2.25rem)] whitespace-nowrap text-accent">
        private collecting · your keys
      </p>

      {/* Stage: the composition box is fitted into it (container units). */}
      <div className="relative mt-[2svh] mb-[2.5svh] flex min-h-0 flex-1 items-center justify-center [container-type:size] landscape:mb-[3svh]">
        <div className="relative aspect-[1550/870] w-[min(100cqw,178cqh)] portrait:aspect-[1000/1300] portrait:w-[min(100cqw,77cqh)] tall:aspect-[1000/1900] tall:w-[min(100cqw,52.6cqh)]">
          {CARDS.map((card, i) => (
            <div key={card.src} className={`absolute -translate-1/2 ${card.pos}`}>
              <animated.div style={cards[i]} className="relative aspect-[3/4] w-full drop-shadow-wire">
                <div className={`absolute inset-0 ${card.clip}`}>
                  {/* Eager, so `usePreloader` waits for them — but not `priority`:
                      four preloads at high priority queued ahead of the hero
                      photo, the page's LCP, which loads under the curtain. */}
                  <Image src={card.src} alt="" fill sizes="35vw" className="object-contain" loading="eager" fetchPriority="low" />
                </div>
              </animated.div>
            </div>
          ))}
          <animated.span
            style={stamp}
            className="type-display absolute top-1/2 left-1/2 -translate-1/2 rounded-[0.12em] border-[0.09em] border-accent bg-background/40 px-[0.28em] py-[0.06em] text-[calc(min(100cqw,178cqh)*0.09)] whitespace-nowrap text-accent portrait:text-[calc(min(100cqw,77cqh)*0.15)] tall:text-[calc(min(100cqw,52.6cqh)*0.2)]"
          >
            Sealed
          </animated.span>
        </div>
      </div>

      {/* Landscape: the counter overlays the stage's lower-left corner, as in the design, so the
          spread can use the full height; portrait keeps it below the pile. */}
      <div className="relative flex shrink-0 items-end gap-[3vw] landscape:absolute landscape:inset-x-[5vw] landscape:bottom-(--edge)">
        <animated.p className="type-display text-[clamp(44px,13vmin,8rem)] leading-[0.8] text-foreground">
          {progress.to(toCounter)}
        </animated.p>
        <div className="h-[0.6vmin] min-h-1 flex-1 bg-foreground/15">
          <animated.div style={{ transform: progress.to((p) => `scaleX(${p})`) }} className="h-full origin-left bg-accent" />
        </div>
      </div>
    </animated.div>
  );
};
