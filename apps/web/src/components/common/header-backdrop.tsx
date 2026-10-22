"use client";

import { animated, useSpring } from "@react-spring/web";
import { useEffect, useState } from "react";

import { cx } from "@/utils/cx";

/**
 * Backdrop of the fixed header: invisible over the hero (the design's own
 * scrim shows there), fades in once the page scrolls so the nav stays legible
 * over any section. `className` can resize it (it fills the header by default).
 */
export const HeaderBackdrop = ({ className }: { className?: string }) => {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const style = useSpring({ opacity: scrolled ? 1 : 0, config: { tension: 220, friction: 30 } });
  return (
    <animated.div
      aria-hidden
      style={style}
      className={cx(
        "pointer-events-none absolute inset-0 -z-10 border-b border-foreground/10 bg-background/80 backdrop-blur-md",
        className,
      )}
    />
  );
};
