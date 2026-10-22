import { SocialLinks } from "@/components/foil/social-links";
import Link from "next/link";

import { HeaderBackdrop } from "@/components/common/header-backdrop";
import { MenuPoster } from "@/components/menu/menu-poster";
import { PlateButton } from "@/components/ui/plate-button";
import { SprayLink } from "@/components/ui/spray-link";
import {PixelIcon} from "@/components/ui/pixel-icon";
import type { CtaLink, NavLink } from "@/data/mocks/home";
import { cx } from "@/utils/cx";

export interface SiteHeaderProps {
  brand: string;
  locale: string;
  nav: readonly NavLink[];
  login: CtaLink;
  cta: CtaLink;
}

const NAV_TEXT = "type-caps text-nav tracking-nav desktop:leading-copy";

/**
 * Figma "Header": desktop 5162:14470 (absolute layers), 1024 5249:889 (full
 * row), 768 5249:1275 (Buy NFT + menu), 390 5249:1628 (menu only).
 */
export const SiteHeader = ({ brand, locale, nav, login, cta }: SiteHeaderProps) => (
  <header className="fixed inset-x-0 top-0 z-25 desktop:h-24.25 desktop:bg-(image:--header-scrim) compact:flex compact:items-center compact:justify-between compact:py-3.5 laptop:px-8 tablet:px-10 mobile:px-5">
    {/* Desktop: the nav row's text sits at 6…12.75, so 18.75 tall gives equal
        padding above and below; the taller Buy NFT plate hangs out of it. */}
    <HeaderBackdrop className="desktop:bottom-auto desktop:h-18.75" />
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-32.5 bg-(image:--header-shade) desktop:hidden"
    />

    <Link
      href="/"
      // The logo points at the page it sits on: prefetching it fetched and
      // decoded this page's RSC payload again while the page was loading.
      prefetch={false}
      aria-label={brand}
      className="relative flex items-center gap-2.25 desktop:absolute desktop:top-3 desktop:left-7.75 desktop:block desktop:h-11.75 desktop:w-43.25"
    >
      <span className="type-display text-logo text-white desktop:absolute desktop:top-4.5 desktop:left-0 desktop:[text-box:trim-both_cap_alphabetic] compact:text-foreground">
        {brand}
      </span>
    </Link>

    <div className="desktop:contents compact:flex compact:items-center laptop:gap-8.5 tablet:gap-4.5">
      <div className="hidden desktop:absolute desktop:top-3 desktop:left-66 desktop:flex"><SocialLinks /></div>

      <nav
        aria-label="Main"
        className="desktop:absolute desktop:top-3 desktop:left-1/2 desktop:-translate-x-1/2 handheld:hidden"
      >
        <ul className="flex items-center gap-8.5 desktop:px-9.75 desktop:py-3">
          {nav.map((item) => (
            <li key={item.label}>
              <SprayLink
                href={item.href}
                current={item.active}
                className={cx(NAV_TEXT, "block text-foreground/75 transition-colors duration-[var(--duration-hover)] ease-entrance hover:text-accent")}
                underlineClassName="-left-4.25 h-5.25 desktop:top-6.25 desktop:w-[calc(100%+1.952rem)] laptop:top-3.75 laptop:w-[calc(100%+2.104rem)]"
              >
                {item.label}
              </SprayLink>
            </li>
          ))}
        </ul>
      </nav>

      <a
        href={login.href}
        className={cx(
          NAV_TEXT,
          "flex items-center text-foreground/75 desktop:absolute desktop:top-6 desktop:left-244.25 desktop:gap-1 laptop:gap-1.25 handheld:hidden",
        )}
      >
        {login.label}
        <PixelIcon name="user" className="size-4 text-accent"/>
      </a>

      <PlateButton
        label={cta.label}
        href={cta.href}
        size="sm"
        plateWidth="desktop:w-33.25 compact:w-34.75"
        className="desktop:absolute! desktop:top-3 desktop:left-307.5 mobile:hidden"
        drips={{
          desktop: [
            "left-4 h-3.75 w-1.25",
            "left-8 h-2 w-1",
            "left-12.5 h-6.75 w-1.5",
            "left-17 h-2.75 w-1",
            "left-22.25 h-5 w-1.25",
            "left-27.25 h-1.75 w-1",
            "left-31.25 h-3.5 w-1.5",
          ],
          compact: ["left-4.25", "left-8.5", "left-13.25", "left-17.75", "left-23.5", "left-28.5", "left-32.75"],
        }}
      />

      <MenuPoster nav={nav} login={login} locale={locale} cta={cta} />
    </div>
  </header>
);
