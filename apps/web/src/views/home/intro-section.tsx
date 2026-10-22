import { CardImage } from "@/components/ui/card-image";
import { PlateButton } from "@/components/ui/plate-button";
import { Rotated } from "@/components/ui/rotated";
import { Vector } from "@/components/ui/vector";
import type { CtaLink } from "@/data/mocks/home";
import { MotionSlot } from "@/components/motion/motion-slot";

interface CardAsset {
  src: string;
  alt: string;
}

export interface IntroSectionProps {
  statement: string;
  statementAccent: string;
  cta: CtaLink;
  aside: string;
  tags: readonly string[];
  cards: { tucked: CardAsset; front: CardAsset };
}

/**
 * Card fan + statement under the hero. Desktop: layers at y 850…2061 of the
 * 1400 frame. Compact: Figma "Cards + statement" (1024 5249:580, 768 5249:973,
 * 390 5249:1328).
 */
export const IntroSection = ({
  statement,
  statementAccent,
  cta,
  aside,
  tags,
  cards,
}: IntroSectionProps) => (
  <section className="relative desktop:h-302.75 compact:flex compact:flex-col laptop:gap-12 laptop:px-8 laptop:pb-12 tablet:gap-10 tablet:px-10 tablet:pt-2 tablet:pb-10 mobile:gap-8 mobile:px-5 mobile:pt-2 mobile:pb-8 mobile:mx-auto mobile:max-w-97.5">
    <div className="relative desktop:static laptop:h-120.5 tablet:h-92.5 mobile:h-51.75">
      {/* Desktop: under the hero fade. Compact: above the hero's card fade. */}
      <Rotated
        box="absolute compact:z-20 desktop:top-31.5 desktop:left-136.75 desktop:h-84.5 desktop:w-64 laptop:top-21.5 laptop:left-106.5 laptop:h-73 laptop:w-55 tablet:top-16.75 tablet:left-75.5 tablet:h-55.75 tablet:w-42.5 mobile:top-9.25 mobile:left-38.5 mobile:h-31.25 mobile:w-23.75"
        rotate="desktop:rotate-[1.45deg] compact:rotate-[1.5deg]"
        parallax={6}
      >
        <CardImage
          {...cards.tucked}
          size="desktop:h-83 desktop:w-62 laptop:h-71.5 laptop:w-53.25 tablet:h-54.75 tablet:w-41 mobile:h-30.75 mobile:w-23"
          designWidth={248}
          index={1}
          crop="top-[-0.02%] left-0 h-[100.04%] w-full"
        />
      </Rotated>
      <Rotated
        box="absolute z-20 desktop:top-20 desktop:left-158 desktop:h-135 desktop:w-119 laptop:top-8.25 laptop:left-130.75 laptop:h-114.75 laptop:w-101.25 tablet:top-6.25 tablet:left-94.25 tablet:h-88 tablet:w-77.75 mobile:top-3.25 mobile:left-48.25 mobile:h-49.25 mobile:w-43.5"
        rotate="desktop:rotate-[20.7deg] compact:rotate-20"
        parallax={-12}
      >
        <CardImage
          {...cards.front}
          size="desktop:h-112.25 desktop:w-84.75 desktop:rounded-card laptop:h-95.5 laptop:w-73 laptop:rounded-art-lg tablet:h-73.25 tablet:w-56 tablet:rounded-art-sm mobile:h-41 mobile:w-31.25 mobile:rounded-art-xs"
          designWidth={339}
          index={2}
        />
      </Rotated>
    </div>

    <Rotated
      box="absolute top-140 left-325 h-12.5 w-14.25 compact:hidden"
      rotate="-rotate-12"
    >
      <Vector src="/assets/shared/crown-lg.svg" size="h-10 w-12.5" inset="inset-[-4.05%_-3.26%]" />
    </Rotated>

    <div className="desktop:static laptop:flex laptop:items-start laptop:gap-12 handheld:flex handheld:flex-col tablet:gap-6 mobile:gap-5">
      <div className="flex flex-col items-start desktop:absolute desktop:top-147.25 desktop:left-8 desktop:w-215 desktop:gap-10 laptop:flex-1 laptop:gap-12 handheld:contents">
        <MotionSlot
          kind="copy"
          as="p"
          className="type-display text-statement leading-statement whitespace-normal text-foreground desktop:[text-box:trim-both_cap_alphabetic] compact:w-full handheld:order-1"
        >
          {statement}
          <span className="text-accent">{statementAccent}</span>
        </MotionSlot>
        <PlateButton
          label={cta.label}
          href={cta.href}
          plateWidth="desktop:w-65 laptop:w-58.75 tablet:w-55.75 mobile:w-52.5"
          className="handheld:order-4 tablet:mt-4 mobile:mt-3"
          drips={{
            desktop: [
              "left-7 h-5.5 w-1.75",
              "left-14.75 h-3 w-1.25",
              "left-23.75 h-9.5 w-2",
              "left-32.25 h-4 w-1.25",
              "left-42.75 h-7 w-1.75",
              "left-52.5 h-2.5 w-1.25",
              "left-60.25 h-5 w-2",
            ],
            laptop: ["left-6.25", "left-13.25", "left-21.5", "left-29", "left-38.5", "left-47.25", "left-54.5"],
            tablet: ["left-6", "left-12.75", "left-20.5", "left-27.75", "left-36.5", "left-45", "left-51.75"],
            mobile: ["left-5.75", "left-12", "left-19.25", "left-26.25", "left-34.5", "left-42.5", "left-48.75"],
          }}
        />
      </div>

      <div className="flex flex-col desktop:absolute desktop:top-184.25 desktop:left-246 desktop:w-96 desktop:items-end desktop:gap-9 laptop:w-85 laptop:shrink-0 laptop:gap-6 handheld:contents">
        <MotionSlot kind="copy" as="p" className="text-body leading-copy text-foreground-muted handheld:order-2">
          {aside}
        </MotionSlot>
        <ul className="flex flex-wrap desktop:w-89 desktop:justify-end desktop:gap-1 compact:w-full compact:gap-2 handheld:order-3">
          {tags.map((tag, i) => (
            <MotionSlot
              kind="chip"
              as="li"
              index={i}
              key={tag}
              className="type-caps rounded-md bg-surface px-3 text-meta tracking-nav text-foreground desktop:py-1.5 desktop:leading-copy desktop:outline-[1.5px] desktop:-outline-offset-[1.5px] desktop:outline-border-strong compact:px-[0.84375rem] compact:py-[0.53125rem] compact:outline-[1.5px] compact:-outline-offset-[1.5px] compact:outline-border-strong"
            >
              {tag}
            </MotionSlot>
          ))}
        </ul>
      </div>
    </div>
  </section>
);
