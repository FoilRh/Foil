"use client";

import { animated, useReducedMotion, useSpring } from "@react-spring/web";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ElementType, type HTMLAttributes, type ReactNode, type RefObject } from "react";

import { useRobot } from "@/components/common/robot-view";
import { RobotText as TextEngine } from "@/components/common/robot-text";
import { Inview } from "@/components/animation/springs/in-view";
import { SpringTrigger } from "@/components/animation/springs/spring-trigger";
import type { TriggerPos } from "@/components/animation/springs/progress-trigger";
import type { Tags } from "@/types/springs";
import { cx } from "@/utils/cx";

import { useMotion } from "./motion-context";
import { MOTION, type MotionKind, type MotionSpec } from "./motion-specs";

export interface MotionSlotProps extends HTMLAttributes<HTMLElement> {
  /** Passed through when the slot renders a link. */
  href?: string;
  kind: MotionKind;
  /**
   * Element to render. Omit to wrap: outside `SiteMotion` the
   * children are returned untouched (no extra DOM on the live page).
   */
  as?: Tags | "s";
  /** Position in a group, for stagger. */
  index?: number;

  className?: string;
  children?: ReactNode;
}

/** `text-center` on the slot needs a matching `justify-center` on TextEngine's flex row. */
const justifyFor = (className?: string) =>
  className?.match(/(\S*:)?text-center/g)?.map((m) => m.replace("text-center", "justify-center")).join(" ");

/**
 * "The viewer has actually reached it": true once the element is 15% above the
 * bottom of the viewport (or, for elements at the very end of the page that
 * can't get that high, once the page is scrolled to the bottom). With `repeat`
 * it turns false again when the element leaves.
 */
const useSeen = (
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  repeat: boolean,
  resetKey: number,
  onReady: (fn: () => void) => () => void,
  interactive: boolean,
) => {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    // A replay remounts the animated element: start hidden again and watch the new node.
    setSeen(false);
    const el = ref.current;
    if (!active || !el) return;
    let visible = false;
    const atBottom = () =>
      window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
    const deep = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) setSeen(true);
      else if (repeat && !visible) setSeen(false);
    }, { rootMargin: interactive ? "0px" : "0px 0px -15% 0px" });
    const any = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && atBottom()) setSeen(true);
      if (!visible && repeat) setSeen(false);
    });
    const onScroll = () => visible && atBottom() && setSeen(true);
    // Nothing is watched until the preloader has lifted.
    const unsubscribe = onReady(() => {
      deep.observe(el);
      any.observe(el);
      window.addEventListener("scroll", onScroll, { passive: true });
    });
    return () => {
      unsubscribe();
      deep.disconnect();
      any.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, [ref, active, repeat, resetKey, onReady, interactive]);
  return seen;
};

/** Outside `SiteMotion` (or on the robot form) there is no preloader to wait for. */
const runNow = (fn: () => void) => {
  fn();
  return () => {};
};

/**
 * TextEngine lays words out as flex items with a fixed `column-gap`; match it
 * to the real width of a space (incl. tracking) so lines break as in the design.
 */
const useSpaceWidth = (ref: RefObject<HTMLElement | null>, enabled: boolean) => {
  const [gap, setGap] = useState<number>();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
    el.appendChild(probe);
    probe.textContent = "x x";
    const spaced = probe.getBoundingClientRect().width;
    probe.textContent = "xx";
    const tight = probe.getBoundingClientRect().width;
    probe.remove();
    const fontSize = parseFloat(getComputedStyle(el).fontSize) || 16;
    setGap((spaced - tight) / fontSize);
  }, [ref, enabled]);
  return gap;
};

/** Blends two style maps whose values are numbers or one-function strings (`scaleY(0)`, `translateX(-12%)`). */
const mix = (from: Record<string, string | number>, to: Record<string, string | number>, p: number) =>
  Object.fromEntries(
    Object.keys(to).map((k) => {
      const a = from[k];
      const b = to[k];
      if (typeof a === "number" && typeof b === "number") return [k, a + (b - a) * p];
      const re = /^([a-zA-Z]+)\((-?[\d.]+)([a-z%]*)\)$/;
      const ma = String(a).match(re);
      const mb = String(b).match(re);
      if (!ma || !mb) return [k, p < 1 ? a : b];
      const v = Number(ma[2]) + (Number(mb[2]) - Number(ma[2])) * p;
      return [k, `${mb[1]}(${v}${mb[3]})`];
    }),
  );

/**
 * Scroll-scrubbed slot. `SpringTrigger` only reports progress here — its own
 * springs use the imperative `api.start` form, which doesn't move values in
 * this project's react-spring build — and a declarative spring applies it.
 */
const Scrub = ({
  tag,
  className,
  spec,
  children,
  ...rest
}: {
  tag: Tags;
  className?: string;
  spec: Extract<MotionSpec, { type: "scrub" }>;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "onChange">) => {
  const [progress, setProgress] = useState(0);
  const style = useSpring({ ...mix(spec.from, spec.to, progress), config: { tension: 280, friction: 40 } });
  return (
    <SpringTrigger
      tag={tag}
      className={className}
      mode="scrub"
      start={spec.start as TriggerPos}
      end={spec.end as TriggerPos}
      onChange={({ progress: p }) => setProgress(p)}
      // Fills the slot — absolutely positioned art (the wire's `fill` image)
      // would otherwise leave the animated layer zero-sized.
      innerClassName="size-full"
      style={spec.style as CSSProperties}
      {...rest}
    >
      <animated.span className={cx("block size-full", spec.innerClassName)} style={style}>
        {children}
      </animated.span>
    </SpringTrigger>
  );
};

const Float = ({
  as,
  className,
  amplitude,
  duration,
  index,
  children,
  ...rest
}: {
  as: Tags;
  className?: string;
  amplitude: string;
  duration: number;
  index: number;
  children?: ReactNode;
} & HTMLAttributes<HTMLElement>) => {
  // Under react-spring's `skipAnimation` (reduced motion — read on the first
  // render, the hook is a render too late — or the robot form) a looping spring
  // restarts in the same tick forever and freezes the page (the pipeline's
  // Fleet Fixes). Still there: it rests at its start.
  const [reduced] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const reducedNow = Boolean(useReducedMotion());
  const robot = useRobot();
  const still = reduced || reducedNow || robot;
  const style = useSpring({
    from: { transform: "translateY(0%)" },
    to: { transform: `translateY(${still ? "0%" : amplitude})` },
    loop: still ? false : { reverse: true },
    delay: index * 230,
    config: { duration: duration + index * 310 },
  });
  const Tag = animated[as] as ElementType;
  return (
    <Tag className={className} style={style} {...rest}>
      {children}
    </Tag>
  );
};

/**
 * An animated spot in the home page. Inside `SiteMotion` it plays its kind's
 * spec from `MOTION` through the project's springs (`Inview`, `SpringTrigger`,
 * `TextEngine`); outside it (or for a kind without a spec) it renders exactly
 * the element it stands for, static.
 */
export const MotionSlot = ({ kind, as, index = 0, className, children, ...rest }: MotionSlotProps) => {
  // The robot form (D-016) renders every slot as its plain element, at rest.
  const robot = useRobot();
  const context = useMotion();
  const motion = robot ? null : context;
  const triggerRef = useRef<HTMLSpanElement>(null);
  const spec = motion ? (MOTION[kind] ?? null) : null;
  const outerRef = useRef<HTMLElement>(null);
  const gap = useSpaceWidth(outerRef, spec?.type === "text");
  const inviewRef = useRef<HTMLElement>(null);
  const seenTarget = spec?.type === "text" ? outerRef : as ? inviewRef : triggerRef;
  const seen = useSeen(seenTarget as RefObject<HTMLElement | null>, spec?.type === "text" || spec?.type === "inview", "repeat" in (spec ?? {}) && Boolean((spec as { repeat?: boolean }).repeat), motion?.replay ?? 0, motion?.onReady ?? runNow, kind === "button");

  if (!spec) {
    if (!as) return <>{children}</>;
    const Tag = as as ElementType;
    return (
      <Tag className={className} {...rest}>
        {children}
      </Tag>
    );
  }

  // `animated` covers every HTML tag; `Tags` just doesn't list `s`.
  const tag = (as ?? "span") as Tags;
  // Tagless slots wrap block art (scribbles, crowns) — `inline-block` would sit
  // on the parent's text baseline and shift the art down.
  const cls = as ? className : cx("block", className);
  const key = `${motion?.replay}-${kind}`;

  if (spec.type === "text") {
    // TextEngine sets an inline `position: relative` — keep the slot's own
    // element (and its absolute layout) outside, the engine inside.
    const layer = spec.layer;
    const Outer = tag as ElementType;
    // TextEngine's own `overflow` never plays in on the hero h1; each headline
    // slot is one line, so the mask goes on the slot itself instead.
    const outerMask = spec.overflow && kind === "headline";
    const overflow = spec.overflow && !outerMask;
    return (
      <Outer ref={outerRef} data-motion={kind} className={cx(cls, outerMask && "overflow-clip py-[0.12em] -my-[0.12em]")} {...rest}>
        <TextEngine
          key={key}
          tag="span"
          // Not `lazy`: mounting engines on approach put their line
          // measurements under the swipe (66–83 ms frames). Every block
          // hydrates in the idle queue under the preloader instead.
          className={justifyFor(cls)}
          columnGap={gap}
          mode={spec.repeat ? "always" : "once"}
          enabled={seen}
          delayIn={(spec.delay ?? 0) + index * 120}
          overflow={overflow}
          wrapLineClassName={overflow ? "py-[0.12em] -my-[0.12em]" : undefined}
          {...{
            [`${layer}In`]: spec.in,
            [`${layer}Out`]: spec.out,
            [`${layer}Stagger`]: spec.stagger,
            [`${layer}Config`]: spec.config,
          }}
        >
          {children}
        </TextEngine>
      </Outer>
    );
  }

  if (spec.type === "scrub") {
    const { onChange: _ignored, ...scrubRest } = rest;
    void _ignored;
    return (
      <Scrub key={key} data-motion={kind} tag={tag} className={cls} spec={spec} {...scrubRest}>
        {children}
      </Scrub>
    );
  }

  if (spec.type === "float") {
    return (
      <Float key={key} data-motion={kind} as={tag} className={cls} amplitude={spec.amplitude} duration={spec.duration} index={index} {...rest}>
        {children}
      </Float>
    );
  }

  const inview = (
    <Inview
      key={key}
      ref={inviewRef}
      data-motion={kind}
      tag={tag}
      className={cls}
      mode={spec.repeat ? "always" : "once"}
      enabled={seen}
      from={spec.from}
      // A keyframe chain is passed through to react-spring as-is.
      to={spec.to as Record<string, string | number>}
      config={spec.config}
      delayIn={(spec.delay ?? 0) + index * (spec.stagger ?? 0)}
      style={spec.style as CSSProperties}
      trigger={as ? undefined : (triggerRef as RefObject<HTMLElement>)}
      {...rest}
    >
      {children}
    </Inview>
  );
  // A tagless slot can start at zero size (`scaleX(0)`), which never
  // intersects — observe an unscaled wrapper instead.
  return as ? (
    inview
  ) : (
    <span ref={triggerRef} className="block">
      {inview}
    </span>
  );
};
