"use client";

import { animated, to, useReducedMotion, useSpring } from "@react-spring/web";
import { useEffect, type HTMLAttributes, type ReactNode } from "react";

import { ProgressTrigger } from "@/components/animation/springs/progress-trigger";
import { useRobot } from "@/components/common/robot-view";
import type { Tags } from "@/types/springs";
import { cx } from "@/utils/cx";

export interface ParallaxProps extends Omit<HTMLAttributes<HTMLElement>, "onChange"> {
  /**
   * Total vertical travel in rem across the element's pass through the
   * viewport. Positive drifts down while the page scrolls (reads as further
   * away, slower than the page); negative drifts up (closer, faster).
   */
  distance: number;
  /**
   * Total rotation in degrees over the same pass, about the layer's centre
   * (positive = clockwise as the page scrolls down). Default 0.
   */
  tilt?: number;
  /** Element of the static, measured layer — `span` inside phrasing content. */
  as?: "div" | "span";
  /** Classes of the static layer (carries the positioning). */
  className?: string;
  /** Classes of the moving layer inside it. */
  innerClassName?: string;
  children?: ReactNode;
}

/**
 * Scroll parallax. The outer layer stays put and is what `ProgressTrigger`
 * measures (moving it would feed its own offset back into the progress); the
 * inner layer is translated (and optionally tilted) by a declarative spring, like `MotionSlot`'s
 * scrub. Centred on progress 0.5, so an element in the middle of the viewport
 * sits exactly where the design puts it. Inert under "reduce motion".
 */
export const Parallax = ({
  distance,
  tilt = 0,
  as = "div",
  className,
  innerClassName,
  children,
  ...rest
}: ParallaxProps) => {
  const reduced = useReducedMotion();
  // Driven imperatively from the trigger's per-frame callback: as React state
  // (the original form) every layer re-rendered on every frame it was in view
  // — 13 layers, from their first frames at load. Same spring, same targets.
  const [{ y, r }, api] = useSpring(() => ({ y: 0, r: 0, config: { tension: 280, friction: 40 } }));
  const onChange = ({ progress }: { progress: number }) => {
    const offset = reduced ? 0 : progress - 0.5;
    api.start({ y: offset * distance, r: offset * tilt });
  };
  // "Reduce motion" switched on (or read after mount): back to the designed place.
  useEffect(() => {
    if (reduced) api.start({ y: 0, r: 0, immediate: true });
  }, [reduced, api]);
  const robot = useRobot();
  const Inner = as === "span" ? animated.span : animated.div;
  if (robot) {
    // The robot form (D-016): the layer at its designed place, no scroll work.
    const Outer = as;
    return (
      <Outer className={className} {...rest}>
        <Outer className={innerClassName ?? "block"}>{children}</Outer>
      </Outer>
    );
  }
  return (
    <ProgressTrigger
      tag={as as Tags}
      className={className}
      start="top bottom"
      end="bottom top"
      onChange={onChange}
      {...rest}
    >
      <Inner
        className={cx(innerClassName ?? "block", "will-change-transform")}
        style={{ transform: to([y, r], (dy, dr) => `translate3d(0, ${dy}rem, 0) rotate(${dr}deg)`) }}
      >
        {children}
      </Inner>
    </ProgressTrigger>
  );
};
