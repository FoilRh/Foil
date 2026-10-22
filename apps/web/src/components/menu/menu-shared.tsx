"use client";

import { useCallback, useEffect, useState } from "react";

import {PixelIcon} from "@/components/ui/pixel-icon";
import type { CtaLink, NavLink } from "@/data/mocks/home";
import { useScroll } from "@/hooks/smooth-scroll/use-scroll";

export interface MenuProps {
  nav: readonly NavLink[];
  login: CtaLink;
  locale: string;
  cta: CtaLink;
}

/** Open state + scroll lock + Esc for the burger menu. */
export const useMenu = () => {
  const [open, setOpen] = useState(false);
  const stop = useScroll((s) => s.stop);
  const start = useScroll((s) => s.start);

  useEffect(() => {
    if (open) stop();
    else start();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, start, stop]);

  // Portals render after mount only — nothing to hydrate on the server pass.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const toggle = useCallback(() => setOpen((o) => !o), []);
  const close = useCallback(() => setOpen(false), []);
  return { open, toggle, close, mounted };
};

/** The header burger — same art and size as the static one in the design. */
export const BurgerButton = ({ open, onClick }: { open: boolean; onClick: () => void }) => (
  <button
    type="button"
    aria-label={open ? "Close menu" : "Open menu"}
    aria-expanded={open}
    onClick={onClick}
    className="pixel-control relative z-50 hidden min-h-11 min-w-11 items-center justify-center handheld:flex"
  >
    <PixelIcon name={open?"close":"menu"} className="size-7 text-accent"/>
  </button>
);

/** Close cross in the accent blue, 22px — matches the FAQ close icon. */
export const CloseButton = ({ onClick, className }: { onClick: () => void; className?: string }) => (
  <button type="button" aria-label="Close menu" onClick={onClick} className={`pixel-control inline-flex min-h-11 min-w-11 items-center justify-center ${className??""}`}>
    <PixelIcon name="close" className="size-6 text-on-inverse"/>
  </button>
);
