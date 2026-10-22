"use client";

import { animated, useSpring, useSprings } from "@react-spring/web";
import { useState, type ReactNode } from "react";

import { cx } from "@/utils/cx";

// Figma "header-spray-underline" (75.2×21.1), split so each part can move.
const LINE = "M8.6 8.1C17.4 4.6 38.1 2.9 67.6 4.1C69.6 4.3 69.6 8.5 67.6 8.9C44 7.7 23.4 10.3 11.6 12.7C9 13.1 7.2 9.3 8.6 8.1Z";
const DRIPS = [
  "M23.4 8.6C23.4 7.77157 22.7284 7.1 21.9 7.1C21.0716 7.1 20.4 7.77157 20.4 8.6V14.6C20.4 15.4284 21.0716 16.1 21.9 16.1C22.7284 16.1 23.4 15.4284 23.4 14.6V8.6Z",
  "M43.7 8.4C43.7 7.68203 43.118 7.1 42.4 7.1C41.682 7.1 41.1 7.68203 41.1 8.4V19.8C41.1 20.518 41.682 21.1 42.4 21.1C43.118 21.1 43.7 20.518 43.7 19.8V8.4Z",
  "M59.2 8.2C59.2 7.59249 58.7075 7.1 58.1 7.1C57.4925 7.1 57 7.59249 57 8.2V13C57 13.6075 57.4925 14.1 58.1 14.1C58.7075 14.1 59.2 13.6075 59.2 13V8.2Z",
] as const;
const DOTS = [
  "M3.6 7.1C4.15229 7.1 4.6 6.65228 4.6 6.1C4.6 5.54772 4.15229 5.1 3.6 5.1C3.04772 5.1 2.6 5.54772 2.6 6.1C2.6 6.65228 3.04772 7.1 3.6 7.1Z",
  "M5.1 14.3C5.4866 14.3 5.8 13.9866 5.8 13.6C5.8 13.2134 5.4866 12.9 5.1 12.9C4.7134 12.9 4.4 13.2134 4.4 13.6C4.4 13.9866 4.7134 14.3 5.1 14.3Z",
  "M0.6 10.7C0.931371 10.7 1.2 10.4314 1.2 10.1C1.2 9.76863 0.931371 9.5 0.6 9.5C0.26863 9.5 0 9.76863 0 10.1C0 10.4314 0.26863 10.7 0.6 10.7Z",
  "M71.6 3.5C72.0971 3.5 72.5 3.09706 72.5 2.6C72.5 2.10294 72.0971 1.7 71.6 1.7C71.1029 1.7 70.7 2.10294 70.7 2.6C70.7 3.09706 71.1029 3.5 71.6 3.5Z",
  "M74.6 8.2C74.9314 8.2 75.2 7.93137 75.2 7.6C75.2 7.26863 74.9314 7 74.6 7C74.2686 7 74 7.26863 74 7.6C74 7.93137 74.2686 8.2 74.6 8.2Z",
  "M63.6 13.3C63.9866 13.3 64.3 12.9866 64.3 12.6C64.3 12.2134 63.9866 11.9 63.6 11.9C63.2134 11.9 62.9 12.2134 62.9 12.6C62.9 12.9866 63.2134 13.3 63.6 13.3Z",
  "M33.4 14.7C33.7314 14.7 34 14.4314 34 14.1C34 13.7686 33.7314 13.5 33.4 13.5C33.0686 13.5 32.8 13.7686 32.8 14.1C32.8 14.4314 33.0686 14.7 33.4 14.7Z",
  "M49.9 1.2C50.2314 1.2 50.5 0.931371 50.5 0.6C50.5 0.268629 50.2314 0 49.9 0C49.5686 0 49.3 0.268629 49.3 0.6C49.3 0.931371 49.5686 1.2 49.9 1.2Z",
  "M15.7 2.3C16.0866 2.3 16.4 1.9866 16.4 1.6C16.4 1.2134 16.0866 0.9 15.7 0.9C15.3134 0.9 15 1.2134 15 1.6C15 1.9866 15.3134 2.3 15.7 2.3Z",
] as const;

export interface SprayLinkProps {
  href: string;
  children: ReactNode;
  /** Classes of the link text. */
  className?: string;
  /** Position + size of the underline box relative to the link's wrapper. */
  underlineClassName: string;
  current?: boolean;
}

/** The underline's `<svg>` attributes — shared by its resting and sprayed forms. */
const SVG = {
  "aria-hidden": true,
  viewBox: "0 0 75.2 21.1",
  preserveAspectRatio: "none",
  overflow: "visible",
  fill: "currentColor",
} as const;
const svgClass = (className: string) => cx("pointer-events-none absolute text-accent", className);

/**
 * The sprayed underline. Mounted on the first hover/focus (`SprayLink`), so its
 * fourteen springs don't start with the page — four nav links were 56 springs
 * in the header's hydration, for an effect only a pointer can trigger. `from`
 * is the unsprayed state, so the first hover plays the full spray.
 */
const Spray = ({ on, className }: { on: boolean; className: string }) => {
  const layer = useSpring({ from: { opacity: 0 }, opacity: on ? 1 : 0, config: on ? { duration: 1 } : { tension: 260, friction: 30 } });
  const line = useSpring({
    from: { clipPath: "inset(0% 100% 0% 0%)" },
    clipPath: on ? "inset(0% 0% 0% 0%)" : "inset(0% 100% 0% 0%)",
    immediate: !on,
    config: { tension: 300, friction: 32 },
  });
  const [drips] = useSprings(
    DRIPS.length,
    (i) => ({
      from: { transform: "scaleY(0)" },
      transform: on ? "scaleY(1)" : "scaleY(0)",
      delay: on ? 160 + i * 70 : 0,
      immediate: !on,
      config: { tension: 110, friction: 9 },
    }),
    [on],
  );
  const [dots] = useSprings(
    DOTS.length,
    (i) => ({
      from: { transform: "scale(0)" },
      transform: on ? "scale(1)" : "scale(0)",
      delay: on ? (i * 37) % 180 : 0,
      immediate: !on,
      config: { tension: 420, friction: 16 },
    }),
    [on],
  );
  return (
    <animated.svg {...SVG} style={layer} className={svgClass(className)}>
      <animated.path d={LINE} style={line} />
      {DRIPS.map((d, i) => (
        <animated.path key={d} d={d} style={{ ...drips[i], transformBox: "fill-box", transformOrigin: "50% 0%" }} />
      ))}
      {DOTS.map((d, i) => (
        <animated.path key={d} d={d} style={{ ...dots[i], transformBox: "fill-box", transformOrigin: "50% 50%" }} />
      ))}
    </animated.svg>
  );
};

/**
 * A link whose graffiti underline is sprayed on only while hovered: the stroke
 * sweeps in left→right, overspray dots pop, and the drips run down with a
 * little overshoot — like fresh paint — then it all fades on leave.
 */
export const SprayLink = ({ href, children, className, underlineClassName, current }: SprayLinkProps) => {
  const [on, setOn] = useState(false);
  const [armed, setArmed] = useState(false);
  const enter = () => {
    setArmed(true);
    setOn(true);
  };
  const leave = () => setOn(false);

  return (
    <span className="relative block" onMouseEnter={enter} onMouseLeave={leave}>
      <a href={href} aria-current={current ? "page" : undefined} className={className} onFocus={enter} onBlur={leave}>
        {children}
      </a>
      {armed ? <Spray on={on} className={underlineClassName} /> : <svg {...SVG} style={{ opacity: 0 }} className={svgClass(underlineClassName)} />}
    </span>
  );
};
