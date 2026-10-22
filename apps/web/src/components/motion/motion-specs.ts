/**
 * The home page's motion set — one spring spec per element kind. Each spec
 * drives the project's own primitives (`Inview`, `SpringTrigger`, `TextEngine`)
 * through `MotionSlot`. Kinds without a spec render static.
 */

import type { SpringConfig } from "@react-spring/web";

/** Element kinds that carry a `MotionSlot` in the sections. */
export type MotionKind =
  | "headline"
  | "mark"
  | "scribble"
  | "copy"
  | "button"
  | "drip"
  | "photo"
  | "card"
  | "chip"
  | "step"
  | "sticker"
  | "ledger"
  | "stamp"
  | "faq"
  | "wordmark";

type Styles = Record<string, string | number>;
type KeyframeStep = Record<string, string | number | SpringConfig>;

export type MotionSpec =
  | {
      type: "inview";
      from: Styles;
      /** A target, or a keyframe chain (each step may carry its own `config`). */
      to: Styles | readonly KeyframeStep[];
      config?: SpringConfig;
      delay?: number;
      stagger?: number;
      style?: Styles;
      /** Replays every time the element re-enters (FAQ answers). */
      repeat?: boolean;
    }
  | {
      type: "scrub";
      from: Styles;
      to: Styles;
      start?: string;
      end?: string;
      style?: Styles;
      /** Classes for the animated inner layer (e.g. its transform origin). */
      innerClassName?: string;
    }
  | { type: "float"; amplitude: string; duration: number }
  | {
      type: "text";
      layer: "line" | "word" | "letter";
      out: Styles;
      in: Styles;
      config?: SpringConfig;
      stagger: number;
      delay?: number;
      overflow?: boolean;
      repeat?: boolean;
    };

const PUNCH: SpringConfig = { tension: 420, friction: 22 };
const SOFT: SpringConfig = { tension: 120, friction: 26 };
const HEAVY: SpringConfig = { tension: 60, friction: 30 };
const DRIP: SpringConfig = { tension: 140, friction: 13 };

/**
 * Spray-can reveal: a soft-edged mask sweeps left→right while the paint
 * settles from a blur. Written exactly as react-spring serialises it (colour
 * format, key order, no `-webkit-` twin) so SSR and hydration match.
 */
const sprayMask = (edge: number) =>
  `linear-gradient(90deg, rgba(0, 0, 0, 1) ${edge}%, rgba(0, 0, 0, 0) ${edge + 22}%)`;
const SPRAY_FROM = { filter: "blur(6px)", maskImage: sprayMask(-22) };
const SPRAY_TO = { filter: "blur(0px)", maskImage: sprayMask(100) };

/**
 * A real rubber stamp: lifted and tilted above the page, it drops, squashes on
 * impact (ink "blooms" from a blur), then settles. Played as a keyframe chain.
 */
const STAMP_FROM = { opacity: 0, transform: "translateY(-55%) scale(2.1) rotate(-14deg)", filter: "blur(3px)" };
const STAMP_TO = [
  { opacity: 0.6, transform: "translateY(-30%) scale(1.6) rotate(-9deg)", filter: "blur(2px)", config: { tension: 260, friction: 26 } },
  { opacity: 1, transform: "translateY(0%) scale(0.9) rotate(1deg)", filter: "blur(0px)", config: { tension: 900, friction: 30 } },
  { opacity: 1, transform: "translateY(0%) scale(1) rotate(0deg)", filter: "blur(0px)", config: { tension: 400, friction: 18 } },
];

export const MOTION: Partial<Record<MotionKind, MotionSpec>> = {
  /** Headlines: lines punch in with a scale overshoot, like a poster stamp. */
  headline: { type: "inview", from: { opacity: 0, transform: "translateY(18%) scale(1.18)" }, to: { opacity: 1, transform: "translateY(0%) scale(1)" }, config: PUNCH, stagger: 110 },
  /** Graffiti words, then their underlines: sprayed on. */
  mark: { type: "inview", from: SPRAY_FROM, to: SPRAY_TO, config: { tension: 55, friction: 20 }, delay: 300 },
  scribble: { type: "inview", from: SPRAY_FROM, to: SPRAY_TO, config: { tension: 70, friction: 20 }, delay: 700 },
  /** Paragraphs: lines slide up from under a mask, one after another. */
  copy: { type: "text", layer: "line", out: { transform: "translateY(100%)" }, in: { transform: "translateY(0%)" }, config: { tension: 170, friction: 26 }, stagger: 70, overflow: true },
  /** Buttons drop in; their drips run down with an overshoot. */
  button: { type: "inview", from: { opacity: 0, transform: "translateY(-30%)" }, to: { opacity: 1, transform: "translateY(0%)" }, config: SOFT },
  drip: { type: "inview", from: { transform: "scaleY(0)" }, to: { transform: "scaleY(1)" }, config: DRIP, delay: 350, stagger: 70, style: { transformOrigin: "50% 0%" } },
  /** Hero vault photo: the lights come on as it eases back. */
  photo: { type: "inview", from: { transform: "scale(1.16)", filter: "brightness(0.25)" }, to: { transform: "scale(1)", filter: "brightness(1)" }, config: HEAVY },
  /** Every card: slapped down onto the table. */
  card: { type: "inview", from: { opacity: 0, transform: "scale(1.35) rotate(-8deg)" }, to: { opacity: 1, transform: "scale(1) rotate(0deg)" }, config: PUNCH, stagger: 90 },
  chip: { type: "inview", from: { opacity: 0, transform: "scale(1.4)" }, to: { opacity: 1, transform: "scale(1)" }, config: PUNCH, stagger: 70 },
  step: { type: "inview", from: { opacity: 0, transform: "scale(1.12)" }, to: { opacity: 1, transform: "scale(1)" }, config: PUNCH, stagger: 100 },
  sticker: { type: "inview", from: { opacity: 0, transform: "scale(1.5) rotate(-12deg)" }, to: { opacity: 1, transform: "scale(1) rotate(0deg)" }, config: { tension: 420, friction: 18 }, stagger: 120 },
  /** Ledger rows fade in; each stamp is pressed like a real one. */
  ledger: { type: "inview", from: { opacity: 0 }, to: { opacity: 1 }, config: SOFT, stagger: 70 },
  stamp: { type: "inview", from: STAMP_FROM, to: STAMP_TO, config: SOFT, delay: 200, stagger: 160 },
  /** FAQ answers drop open each time. */
  faq: { type: "inview", from: { opacity: 0, transform: "translateY(-30%)" }, to: { opacity: 1, transform: "translateY(0%)" }, config: SOFT, repeat: true },
  /** Footer HELD-MINT outline: letters stand up one by one. */
  wordmark: { type: "text", layer: "letter", out: { y: 80, opacity: 0 }, in: { y: 0, opacity: 1 }, config: { tension: 200, friction: 22 }, stagger: 45 },
};
