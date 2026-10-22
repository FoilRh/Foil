import { CardImage } from "@/components/ui/card-image";
import { Eyebrow } from "@/components/ui/eyebrow";
import { GhostWord } from "@/components/ui/ghost-word";
import { PlateButton } from "@/components/ui/plate-button";
import { Rotated } from "@/components/ui/rotated";
import { Vector } from "@/components/ui/vector";
import type { CtaLink, Stat } from "@/data/mocks/home";

import { VaultFan } from "./vault-fan";
import { MotionSlot } from "@/components/motion/motion-slot";

export interface VaultSectionProps {
  eyebrow: string;
  title: string;
  mark: string;
  ghost: string;
  lead: string;
  cards: ReadonlyArray<{ src: string; alt: string }>;
  stats: readonly Stat[];
  cta: CtaLink;
}

const BRACKET = "type-caps text-bracket text-accent";

/** Figma "Vault": 1400 5162:14584 · 1024 5249:662 · 768 5249:1053 · 390 5249:1407. */
export const VaultSection = ({ eyebrow, title, mark, ghost, lead, cards, stats, cta }: VaultSectionProps) => (
  <section
    id="vault"
    className="relative overflow-clip desktop:h-315 desktop:bg-background compact:flex compact:flex-col compact:items-center laptop:gap-12 laptop:px-8 laptop:pt-12 laptop:pb-9.5 tablet:gap-10 tablet:px-10 tablet:pt-10 tablet:pb-8 mobile:gap-8 mobile:px-5 mobile:pt-8 mobile:pb-6.5 mobile:mx-auto mobile:max-w-97.5"
  >
    <GhostWord
      word={ghost}
      box="desktop:top-21.5 desktop:left-166.5 desktop:h-98.25 desktop:w-161.75 laptop:top-2.5 laptop:left-64 laptop:h-79.25 laptop:w-128.25 tablet:top-2.5 tablet:left-46.5 tablet:h-61 tablet:w-99 mobile:hidden"
      rotate="desktop:rotate-6 compact:rotate-7"
      size="text-ghost-md"
    />

    <div className="relative flex w-full flex-col items-center desktop:static desktop:block laptop:gap-3 tablet:gap-3 mobile:gap-2.5">
      <Eyebrow
        label={eyebrow}
        crownBox="desktop:top-37 desktop:left-20 desktop:h-9 desktop:w-10.5"
        labelBox="desktop:top-34 desktop:left-35 desktop:h-10 desktop:w-29.5"
      />
      <h2 className="type-display flex w-full flex-wrap items-center justify-center text-display text-foreground desktop:block laptop:gap-x-4.25 tablet:gap-x-3.25 mobile:gap-x-2.25">
        <MotionSlot kind="headline" as="span" index={0} className="desktop:absolute desktop:top-51.5 desktop:left-21">{title}</MotionSlot>
        <span className="relative shrink-0 desktop:static laptop:h-26.5 laptop:w-64 tablet:h-19.75 tablet:w-48 mobile:h-13.25 mobile:w-35">
          <Rotated
            as="span"
            box="absolute desktop:top-41.5 desktop:left-185.75 desktop:h-47 desktop:w-67.5 laptop:-top-1.5 laptop:left-0.5 laptop:h-29.25 laptop:w-64 tablet:-top-1 tablet:left-0.5 tablet:h-21.75 tablet:w-48 mobile:-top-0.75 mobile:left-0.5 mobile:h-14.75 mobile:w-35"
            rotate="-rotate-4"
          >
            <MotionSlot kind="mark" as="span" className="type-script text-script-xl text-accent normal-case not-italic compact:-translate-y-[0.04em]">{mark}</MotionSlot>
          </Rotated>
          <Rotated
            as="span"
            box="absolute desktop:top-79.75 desktop:left-186.75 desktop:h-4.5 desktop:w-61.5 laptop:top-22 laptop:left-1.5 laptop:h-3.25 laptop:w-37.25 tablet:top-16.25 tablet:left-1.5 tablet:h-2.75 tablet:w-27.75 mobile:top-11 mobile:left-1.5 mobile:h-2.25 mobile:w-18.75"
            rotate="-rotate-3"
          >
            <MotionSlot kind="scribble">
              <Vector
                src="/assets/vault/vault-scribble.svg"
                sources={{
                  laptop: "/assets/vault/vault-scribble-laptop.svg",
                  tablet: "/assets/vault/vault-scribble-tablet.svg",
                  mobile: "/assets/vault/vault-scribble-mobile.svg",
                }}
                size="h-1.25 desktop:w-61.5 laptop:w-37.25 tablet:w-27.75 mobile:w-18.75"
                inset="desktop:inset-[-74.12%_-1.42%] laptop:inset-[-56.12%_-1.78%] tablet:inset-[-42.35%_-1.8%] mobile:inset-[-42.34%_-2.67%]"
              />
            </MotionSlot>
          </Rotated>
        </span>
      </h2>
    </div>

    <div className="flex items-start gap-2.5 desktop:static desktop:block laptop:w-115 tablet:w-115 mobile:w-full">
      <span aria-hidden className={`${BRACKET} desktop:absolute desktop:top-87 desktop:left-232.5`}>
        [
      </span>
      <MotionSlot
        kind="copy"
        as="p"
        className="flex-1 text-caption leading-copy desktop:absolute desktop:top-89 desktop:left-239 desktop:w-90 desktop:text-foreground-soft compact:text-foreground-muted"
      >
        {lead}
      </MotionSlot>
      <span
        aria-hidden
        className={`${BRACKET} desktop:absolute desktop:top-98.75 desktop:left-332 compact:flex compact:w-2.5 compact:self-stretch compact:items-end`}
      >
        ]
      </span>
    </div>

    <VaultFan cards={cards} />

    <Rotated box="absolute top-134 left-21.25 h-14.75 w-16.75 compact:hidden" rotate="rotate-14">
      <Vector src="/assets/vault/vault-crown.svg" size="h-11.5 w-14.5" inset="inset-[-4.06%_-3.26%]" />
    </Rotated>
    <Rotated box="absolute top-125 left-312 h-12.5 w-14.25 compact:hidden" rotate="-rotate-12">
      <Vector src="/assets/shared/crown-lg.svg" size="h-10 w-12.5" inset="inset-[-4.05%_-3.26%]" />
    </Rotated>

    <p className="type-caps flex items-center justify-center rounded-plate border-2 border-border-strong bg-surface text-plate tracking-nav text-foreground desktop:absolute desktop:top-256.5 desktop:left-100.25 desktop:h-15 desktop:w-150 desktop:justify-start desktop:pl-11.5 desktop:whitespace-pre laptop:gap-6.5 laptop:px-10 laptop:py-3.5 tablet:gap-6.5 tablet:px-10 tablet:py-3.5 mobile:w-full mobile:flex-wrap mobile:gap-x-3.5 mobile:gap-y-1.5 mobile:px-4.5 mobile:py-3.5">
      {stats.map((stat, i) => (
        <span key={stat.label}>
          {/* Desktop spaces the pairs with literal spaces (Figma text layer); compact uses gap. */}
          {i > 0 && <span className="compact:hidden">{"    "}</span>}
          {`${stat.label} `}
          <span className="text-accent">{stat.value}</span>
        </span>
      ))}
    </p>

    <div className="flex w-full justify-center desktop:static desktop:block compact:pb-8.5">
      <Rotated
        box="relative desktop:absolute desktop:top-286 desktop:left-138.5 desktop:h-18.75 desktop:w-72.5 laptop:h-17.75 laptop:w-65.75 tablet:h-16.75 tablet:w-62.25 mobile:h-16.5 mobile:w-58.75"
        rotate="rotate-2"
      >
        <PlateButton
          label={cta.label}
          href={cta.href}
          plateWidth="desktop:w-70.25 laptop:w-63.75 tablet:w-60.25 mobile:w-56.75"
          drips={{
            desktop: [
              "left-7.25 h-5.5 w-1.75",
              "left-15.75 h-3 w-1.25",
              "left-25.75 h-9.5 w-2",
              "left-34.75 h-4 w-1.25",
              "left-46 h-7 w-1.75",
              "left-56.5 h-2.5 w-1.25",
              "left-65 h-5 w-2",
            ],
            laptop: ["left-6.5", "left-14.25", "left-23.25", "left-31.5", "left-41.75", "left-51.25", "left-59"],
            tablet: ["left-6.25", "left-13.5", "left-22", "left-29.75", "left-39.5", "left-48.5", "left-55.75"],
            mobile: ["left-6", "left-12.75", "left-20.75", "left-28.25", "left-37.25", "left-45.75", "left-52.5"],
          }}
        />
      </Rotated>
    </div>
  </section>
);
