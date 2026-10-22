"use client";

import { animated, useSpring, useTrail } from "@react-spring/web";
import Image from "next/image";
import { createPortal } from "react-dom";

import { PlateButton } from "@/components/ui/plate-button";
import {PixelIcon} from "@/components/ui/pixel-icon";
import { Vector } from "@/components/ui/vector";
import { cx } from "@/utils/cx";

import { BurgerButton, CloseButton, type MenuProps, useMenu } from "./menu-shared";

const DRIPS = { desktop: [], compact: ["left-6.5", "left-13.5", "left-21.5", "left-29", "left-38", "left-46.75", "left-53.75"] };

/**
 * Burger menu (compact): the light Featured-drop poster drops over the page at a tilt and
 * settles; links are set in the poster's black italic with the KR777 scribble
 * under the current page.
 */
export const MenuPoster = ({ nav, login, locale, cta }: MenuProps) => {
  const { open, toggle, close, mounted } = useMenu();
  const sheet = useSpring({
    transform: open ? "translateY(0%) rotate(-1.5deg)" : "translateY(-115%) rotate(-7deg)",
    config: { tension: 210, friction: 22 },
  });
  const backdrop = useSpring({ opacity: open ? 1 : 0, config: { tension: 200, friction: 30 } });
  const trail = useTrail(nav.length + 1, {
    opacity: open ? 1 : 0,
    transform: open ? "translateX(0%)" : "translateX(-12%)",
    delay: open ? 180 : 0,
    config: { tension: 260, friction: 24 },
  });

  return (
    <>
      <BurgerButton open={open} onClick={toggle} />
      {mounted &&
        createPortal(
          <div className={cx("fixed inset-0 z-[60]", !open && "pointer-events-none")} aria-hidden={!open} inert={!open}>
            <animated.div style={backdrop} className="absolute inset-0 bg-background/80" onClick={close} />
            <animated.div
              style={sheet}
              className="absolute inset-x-3 top-3 bottom-3 flex flex-col overflow-hidden bg-surface-poster px-6 pt-5 pb-8 text-on-inverse tablet:inset-x-6 tablet:top-6 tablet:bottom-6 tablet:px-12 tablet:pt-10 tablet:pb-12"
            >
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-3">
                  <PixelIcon name="crown" className="size-7 text-accent-strong tablet:size-10"/>
                  <span className="type-script text-eyebrow text-accent-strong tablet:text-[2rem]">menu</span>
                </span>
                <CloseButton onClick={close} />
              </div>

              <nav aria-label="Menu" className="mt-10 flex flex-1 flex-col gap-3 tablet:mt-16 tablet:gap-5">
                {nav.map((item, i) => (
                  <animated.a
                    key={item.label}
                    href={item.href}
                    onClick={close}
                    style={trail[i]}
                    className={cx(
                      "type-display relative w-fit text-[3.5rem] tablet:text-[6rem]",
                      item.active ? "text-accent-strong" : "text-on-inverse",
                    )}
                  >
                    {item.label}
                    {item.active && (
                      <Vector
                        src="/assets/drop/drop-scribble-mobile.svg"
                        size="h-1.25 w-full"
                        inset="inset-[-42.35%_-1.59%]"
                        className="absolute! -bottom-0.5 left-0 -rotate-2"
                      />
                    )}
                  </animated.a>
                ))}
              </nav>

              <animated.div style={trail[nav.length]} className="flex flex-col gap-6">
                <span className="type-display flex items-center gap-8 text-[1.5rem] text-on-inverse tablet:gap-12 tablet:text-[2.25rem]">
                  <span className="text-on-inverse/60">
                    {locale}
                  </span>
                  <a href={login.href} className="flex items-center gap-2">
                    {login.label}
                    <PixelIcon name="user" className="size-5 tablet:size-7"/>
                  </a>
                </span>
                <PlateButton label={cta.label} href={cta.href} plateWidth="compact:w-58" drips={DRIPS} />
              </animated.div>

              <div className="pointer-events-none absolute -right-24 -bottom-28 size-90 rotate-[200deg] drop-shadow-wire">
                <Image src="/assets/drop/drop-barbed-wire-arc.png" alt="" fill sizes="90vw" fetchPriority="low" className="object-contain" />
              </div>
            </animated.div>
          </div>,
          document.body,
        )}
    </>
  );
};
