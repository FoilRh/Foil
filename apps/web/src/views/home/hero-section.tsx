import Image from "next/image";
import { CardImage } from "@/components/ui/card-image";
import { Eyebrow } from "@/components/ui/eyebrow";
import { PlateButton } from "@/components/ui/plate-button";
import { Rotated } from "@/components/ui/rotated";
import { Vector } from "@/components/ui/vector";
import type { CtaLink } from "@/data/mocks/home";
import { MotionSlot } from "@/components/motion/motion-slot";
import { Parallax } from "@/components/motion/parallax";

interface CardAsset {
  src: string;
  alt: string;
}

export interface HeroSectionProps {
  eyebrow: string;
  titleLine1: string;
  titleLine2: string;
  titleMark: string;
  lead: readonly [string, string];
  cta: CtaLink;
  image: string;
  /** Desktop's left card and the compact frames' "tucked" card. */
  cards: { left: CardAsset; tucked: CardAsset };
}

/**
 * Hero — full viewport height on every breakpoint. Media and fades are pinned
 * to the bottom edge with each frame's offsets, so the composition holds as
 * the window gets taller or shorter than the Figma frame.
 */
export const HeroSection = ({
  eyebrow,
  titleLine1,
  titleLine2,
  titleMark,
  lead,
  cta,
  image,
  cards,
}: HeroSectionProps) => (
  <section className="relative z-10 flex h-svh flex-col justify-end desktop:min-h-112.5 compact:min-h-120 laptop:px-8 laptop:pb-12 tablet:px-10 tablet:pb-10 mobile:px-5 mobile:pb-8">
    {/* Desktop left card — sits under the photo, peeking out below it. */}
    <Rotated
      box="absolute hidden desktop:flex -bottom-111.5 left-21.5 h-117.5 w-102.25"
      rotate="rotate-[-19.7deg]"
      parallax={-14}
    >
      <CardImage {...cards.left} size="h-98.75 w-73.25 rounded-art-tilt" designWidth={293} />
    </Rotated>

    <div className="absolute inset-x-0 top-0 overflow-hidden desktop:bottom-0 laptop:bottom-29.75 tablet:bottom-26 mobile:bottom-60.5">
      {/* Drifts down at a fraction of the scroll, so the vault recedes behind the copy. */}
      <Parallax distance={24} className="absolute inset-0" innerClassName="absolute inset-0">
        <MotionSlot
          kind="photo"
          as="div"
          className="absolute desktop:inset-x-0 desktop:top-1/2 desktop:aspect-[2752/1536] desktop:-translate-y-1/2 compact:inset-0"
        >
          {/* Compact frames crop the 16:9 photo to a taller box, so it renders wider than the viewport
              (a 412×823 phone: the box is 412×581, the cover 1,041 px = 253vw). */}
          <Image
            src={image}
            alt=""
            fill
            // `preload` + an explicit high fetch priority: on Next 16 `priority`
            // only preloads — the request went out at Low, behind the scripts.
            preload
            fetchPriority="high"
            sizes="(width < 700px) 255vw, (width < 896px) 215vw, (width < 1200px) 115vw, 100vw"
            className="object-cover"
          />
        </MotionSlot>
      </Parallax>
      <div className="absolute inset-0 bg-(image:--hero-vignette) compact:hidden" />
    </div>

    {/* Anchored to the content column so it stays under the card row on wide phones. */}
    <div className="absolute inset-x-0 bottom-0 mx-auto h-0 desktop:hidden mobile:max-w-97.5">
      <Rotated
        box="absolute laptop:-bottom-96.75 laptop:left-7 laptop:h-120.5 laptop:w-105.75 tablet:-bottom-82.5 tablet:left-3 tablet:h-92.5 tablet:w-81.25 mobile:-bottom-46.75 mobile:-left-1.25 mobile:h-52 mobile:w-45.5"
        rotate="-rotate-21"
        parallax={-8}
      >
        {/* Same Prime Ape art as the desktop left card. */}
        <CardImage
          {...cards.left}
          size="rounded-art-tilt laptop:h-100.25 laptop:w-74.75 tablet:h-77 tablet:w-57.5 mobile:h-43.25 mobile:w-32.25"
          designWidth={299}
        />
      </Rotated>
    </div>

    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 desktop:-bottom-38.5 desktop:h-143.25 desktop:bg-(image:--hero-fade) compact:bg-(image:--hero-fade-compact) laptop:bottom-29.5 laptop:h-81.25 tablet:bottom-25.75 tablet:h-115 mobile:bottom-60.25 mobile:h-75.25"
    />
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bg-(image:--card-fade) desktop:hidden laptop:-bottom-36.5 laptop:h-70.25 tablet:-bottom-36.25 tablet:h-56.25 mobile:-bottom-20.75 mobile:h-36"
    />

    {/* Copy — desktop: layers at y 512…850 of the 1400 frame. */}
    <div className="relative flex desktop:absolute desktop:inset-x-0 desktop:bottom-0 desktop:block desktop:h-84.5 mobile:mx-auto mobile:w-full mobile:max-w-87.5 laptop:items-end laptop:gap-12 tablet:items-end tablet:gap-8 mobile:flex-col mobile:items-center mobile:gap-5">
      <div className="flex flex-col compact:flex-1 laptop:gap-3 tablet:gap-3 mobile:w-full mobile:items-center mobile:gap-2.5">
        <Eyebrow
          label={eyebrow}
          crownBox="desktop:top-5 desktop:left-7 desktop:h-9 desktop:w-10.5"
          labelBox="desktop:top-0 desktop:left-22 desktop:h-12 desktop:w-67"
        />

        <h1 className="type-display flex w-full flex-col text-display text-foreground desktop:block mobile:items-center">
          <MotionSlot kind="headline" as="span" index={0} className="block desktop:absolute desktop:top-13.5 desktop:left-8 laptop:-mb-3.25 tablet:-mb-2.5 mobile:-mb-1.75 mobile:text-center">
            {titleLine1}
          </MotionSlot>
          <span className="flex flex-wrap items-center desktop:block laptop:gap-x-4.25 tablet:gap-x-3.25 mobile:justify-center mobile:gap-x-2.25">
            <MotionSlot kind="headline" as="span" index={1} className="desktop:absolute desktop:top-45.75 desktop:left-8">{titleLine2}</MotionSlot>
            <span className="relative shrink-0 desktop:static laptop:h-24.5 laptop:w-52 tablet:h-18.25 tablet:w-39 mobile:h-12.25 mobile:w-26.75">
              <Rotated
                as="span"
                box="absolute desktop:top-38 desktop:left-111.5 desktop:h-43.75 desktop:w-81.25 laptop:-top-1.75 laptop:left-0.5 laptop:h-28 laptop:w-52 tablet:-top-1.25 tablet:left-0.5 tablet:h-20.75 tablet:w-38.75 mobile:-top-1 mobile:left-0.5 mobile:h-14 mobile:w-26"
                rotate="-rotate-4"
              >
                <MotionSlot kind="mark" as="span" className="type-script text-script-lg text-accent normal-case not-italic compact:-translate-y-[0.04em]">{titleMark}</MotionSlot>
              </Rotated>
              <Rotated
                as="span"
                box="absolute desktop:top-75.75 desktop:left-113 desktop:h-5 desktop:w-72.5 laptop:top-19.5 laptop:left-1.5 laptop:h-3.5 laptop:w-46.5 tablet:top-14.5 tablet:left-1.5 tablet:h-3 tablet:w-34.5 mobile:top-9.75 mobile:left-1.5 mobile:h-2.5 mobile:w-23.25"
                rotate="-rotate-3"
              >
                <MotionSlot kind="scribble">
                  <Vector
                    src="/assets/hero/hero-scribble.svg"
                    sources={{
                      laptop: "/assets/hero/hero-scribble-laptop.svg",
                      tablet: "/assets/hero/hero-scribble-tablet.svg",
                      mobile: "/assets/hero/hero-scribble-mobile.svg",
                    }}
                    size="h-1.25 desktop:w-72.5 laptop:w-46.5 tablet:w-34.5 mobile:w-23.25"
                    inset="desktop:inset-[-74.12%_-1.21%] laptop:inset-[-51.88%_-1.32%] tablet:inset-[-42.35%_-1.45%] mobile:inset-[-42.34%_-2.15%]"
                  />
                </MotionSlot>
              </Rotated>
            </span>
          </span>
        </h1>
      </div>

      <div className="flex shrink-0 flex-col items-start desktop:absolute desktop:top-43 desktop:left-233.25 desktop:w-108.75 desktop:gap-8 laptop:w-85 laptop:gap-6 tablet:w-61 tablet:gap-6 tablet:pb-2.5 mobile:w-full mobile:items-center mobile:gap-5">
        <MotionSlot kind="copy" as="p" className="text-body leading-copy text-foreground-muted mobile:w-83 mobile:text-center">
          {lead[0]} <span className="hidden mobile:block mobile:w-full" />
          {lead[1]}
        </MotionSlot>
        <PlateButton
          label={cta.label}
          href={cta.href}
          plateWidth="desktop:w-64 laptop:w-58 tablet:w-54.75 mobile:w-51.75"
          drips={{
            desktop: [
              "left-6.75 h-5.5 w-1.75",
              "left-14.5 h-3 w-1.25",
              "left-23.5 h-9.5 w-2",
              "left-31.75 h-4 w-1.25",
              "left-42 h-7 w-1.75",
              "left-51.75 h-2.5 w-1.25",
              "left-59.25 h-5 w-2",
            ],
            laptop: ["left-6.25", "left-13", "left-21.25", "left-28.75", "left-38", "left-46.75", "left-53.75"],
            tablet: ["left-6", "left-12.5", "left-20", "left-27.25", "left-36", "left-44.25", "left-50.75"],
            mobile: ["left-5.75", "left-11.75", "left-19", "left-25.75", "left-34", "left-41.75", "left-48"],
          }}
        />
      </div>
    </div>
  </section>
);
