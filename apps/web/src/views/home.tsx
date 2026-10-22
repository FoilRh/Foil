import type { ReactNode } from "react";

import { HydrateWhenIdle } from "@/components/common/hydrate-when-idle";
import { homeContent } from "@/data/mocks/home";

import { BarbedWire } from "./home/barbed-wire";
import { DropSection } from "./home/drop-section";
import { HeroSection } from "./home/hero-section";
import { IntroSection } from "./home/intro-section";
import { JoinSection } from "./home/join-section";
import { ProcessSection } from "./home/process-section";
import { QuestionsSection } from "./home/questions-section";
import { RecordSection } from "./home/record-section";
import { SiteFooter } from "./home/site-footer";
import { SiteHeader } from "./home/site-header";
import { VaultSection } from "./home/vault-section";

/**
 * Home view — Figma "Get Layers" → Concept 16, four frames (1400 / 1024 / 768
 * / 390; see DESIGN-MAP.md). Each breakpoint range is laid out in rem against
 * its own frame width and the root font-size scales with the viewport
 * (globals.css), so every range is its frame, scaled.
 */
export interface HomeViewProps {
  /** Overlay rendered above the page (the preloader). */
  overlay?: ReactNode;
}

export const HomeView = ({ overlay }: HomeViewProps = {}) => {
  const c = homeContent;
  return (
    <main className="relative overflow-x-clip bg-background">
      {/* Page level, not inside the hero: the hero's `z-10` stacking context
          would trap it under the intro cards (`z-20`). */}
      {/* Every block — the header and hero too — hydrates in its own idle
          task after `load`, in page order, while the preloader still covers
          the page: the first commit holds only the curtain itself. One commit
          for the lot was the phone's blocking time. */}
      <HydrateWhenIdle>
        <SiteHeader {...c.header} />
      </HydrateWhenIdle>
      <HydrateWhenIdle>
        <HeroSection
          {...c.hero}
          cards={{ left: c.intro.cards.left, tucked: c.intro.cards.tucked }}
        />
      </HydrateWhenIdle>
      <HydrateWhenIdle>
        <IntroSection {...c.intro} />
      </HydrateWhenIdle>
      <HydrateWhenIdle>
        <BarbedWire
          box="desktop:-top-51.75 desktop:-left-38.25 desktop:h-137.5 desktop:w-408.25 laptop:-top-4.25 laptop:-left-23.25 laptop:h-100.5 laptop:w-298.75 tablet:-top-5.75 tablet:-left-16 tablet:h-75.5 tablet:w-224 mobile:-top-[0.815vw] mobile:-left-[23.295vw] mobile:h-[44.536vw] mobile:w-[132.21vw]"
          mobileSize="mobile:h-[130.99vw] mobile:w-[40.385vw]"
          parallax={10}
        />
      </HydrateWhenIdle>
      <HydrateWhenIdle>
        <ProcessSection {...c.process} />
      </HydrateWhenIdle>
      <HydrateWhenIdle>
        <VaultSection {...c.vault} />
      </HydrateWhenIdle>
      <HydrateWhenIdle>
        <DropSection {...c.drop} />
      </HydrateWhenIdle>
      <HydrateWhenIdle>
        <RecordSection {...c.record} />
      </HydrateWhenIdle>
      <HydrateWhenIdle>
        <QuestionsSection {...c.questions} />
      </HydrateWhenIdle>
      <HydrateWhenIdle>
        <BarbedWire
          box="desktop:-top-39.25 desktop:-left-38.25 desktop:h-137.5 desktop:w-408.25 laptop:-top-6 laptop:-left-24 laptop:h-100.5 laptop:w-298.75 tablet:-top-3.5 tablet:-left-18.25 tablet:h-75.5 tablet:w-224 mobile:top-[2.051vw] mobile:-left-[8.328vw] mobile:h-[39.297vw] mobile:w-[116.655vw]"
          mobileSize="mobile:h-[115.578vw] mobile:w-[35.633vw]"
          parallax={-8}
        />
      </HydrateWhenIdle>
      <HydrateWhenIdle>
        <div className="relative desktop:bg-background">
          <JoinSection {...c.join} />
          <SiteFooter {...c.footer} />
        </div>
      </HydrateWhenIdle>

      {/* Figma "Texture — grain (screen)" over the whole page. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-30 bg-[url(/assets/shared/texture-grain.webp)] bg-size-[--spacing(128)] opacity-20 mix-blend-screen"
      />
      {overlay}
    </main>
  );
};
