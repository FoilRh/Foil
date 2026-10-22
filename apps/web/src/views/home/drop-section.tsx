import Image from "next/image";

import { CardImage } from "@/components/ui/card-image";
import { Rotated } from "@/components/ui/rotated";
import { Vector } from "@/components/ui/vector";
import { MotionSlot } from "@/components/motion/motion-slot";

export interface DropSectionProps {
  eyebrow: string;
  title: string;
  mark: string;
  points: readonly string[];
  shelf: string;
  price: string;
  card: { src: string; alt: string };
}

/** Bullet + copy offsets inside the poster, per point (absolute frames). */
const POINTS = [
  {
    bullet:
      "desktop:top-78.75 desktop:left-14 desktop:h-2.25 desktop:w-2 laptop:top-84.75 laptop:left-12 tablet:top-54 tablet:left-9",
    text: "desktop:top-77 desktop:left-21.25 desktop:w-72.5 laptop:top-82.5 laptop:left-17.5 laptop:w-65.75 tablet:top-52 tablet:left-14.5 tablet:w-48",
  },
  {
    bullet:
      "desktop:top-103.25 desktop:left-14 desktop:h-2.25 desktop:w-2 laptop:top-119 laptop:left-12 tablet:top-90.5 tablet:left-9",
    text: "desktop:top-101.5 desktop:left-21.25 desktop:w-72.5 laptop:top-116.75 laptop:left-17.5 laptop:w-65.75 tablet:top-88.5 tablet:left-14.5 tablet:w-48",
  },
] as const;

/**
 * Barbed-wire arcs around the poster, each with its own parallax travel (rem)
 * so the wire layers separate from the card on scroll. The 390 frame keeps
 * the last two.
 */
const ARCS = [
  {
    box: "desktop:top-8.5 desktop:left-133.5 desktop:size-282.75 laptop:-top-2 laptop:left-89.5 laptop:size-263 tablet:-top-0.75 tablet:left-67 tablet:size-197.25 mobile:hidden",
    rotate: "rotate-4",
    size: "desktop:size-265 laptop:size-246.5 tablet:size-185",
    parallax: 8,
  },
  {
    box: "desktop:top-3.5 desktop:-left-66.5 desktop:size-282.75 laptop:-top-6.75 laptop:-left-96.5 laptop:size-263 tablet:-top-4.25 tablet:-left-72.5 tablet:size-197.25 mobile:hidden",
    rotate: "-rotate-176",
    size: "desktop:size-265 laptop:size-246.5 tablet:size-185",
    parallax: -6,
  },
  {
    box: "desktop:-top-92.5 desktop:left-36 desktop:size-288.25 laptop:-top-96.25 laptop:-left-1.5 laptop:size-268 tablet:-top-71.25 tablet:-left-1 tablet:size-201 mobile:-top-40.5 mobile:-left-9 mobile:size-119.5",
    rotate: "-rotate-86",
    size: "desktop:size-270 laptop:size-251.25 tablet:size-188.25 mobile:size-112",
    parallax: 12,
  },
  {
    box: "desktop:top-99.5 desktop:left-26 desktop:size-288.25 laptop:top-82.25 laptop:-left-10.75 laptop:size-268 tablet:top-62.75 tablet:-left-8 tablet:size-201 mobile:top-132 mobile:-left-13 mobile:size-119.5",
    rotate: "rotate-94",
    size: "desktop:size-270 laptop:size-251.25 tablet:size-188.25 mobile:size-112",
    parallax: -9,
  },
] as const;

const ABS = "desktop:absolute laptop:absolute tablet:absolute";

/** Figma "Featured drop": 1400 5162:14862 · 1024 5249:702 · 768 5249:1093 · 390 5249:1444. */
export const DropSection = ({ eyebrow, title, mark, points, shelf, price, card }: DropSectionProps) => (
  <section className="relative desktop:h-282.5 desktop:overflow-clip desktop:bg-background compact:flex compact:flex-col compact:items-center laptop:px-8 laptop:py-29.5 tablet:px-10 tablet:py-23 mobile:px-7.5 mobile:py-16 mobile:mx-auto mobile:max-w-97.5">
    <div className="relative overflow-clip bg-surface-poster desktop:absolute desktop:top-42.5 desktop:left-67.5 desktop:h-210 desktop:w-215 laptop:h-195.25 laptop:w-200 tablet:h-146.5 tablet:w-150 mobile:flex mobile:w-full mobile:flex-col mobile:gap-8 mobile:p-5.5">
      <div className="mobile:flex mobile:w-full mobile:flex-col mobile:items-center mobile:gap-2.5">
        <div className="mobile:flex mobile:items-center mobile:gap-3">
          <Rotated
            box={`${ABS} desktop:top-13 desktop:left-14 desktop:h-8 desktop:w-9.5 laptop:top-12.5 laptop:left-12 tablet:top-9.5 tablet:left-9`}
            rotate="desktop:rotate-8"
          >
            <Vector
              src="/assets/drop/drop-crown.svg"
              sources={{
                laptop: "/assets/drop/drop-crown-laptop.svg",
                tablet: "/assets/drop/drop-crown-tablet.svg",
                mobile: "/assets/drop/drop-crown-mobile.svg",
              }}
              size="desktop:h-7 desktop:w-8.5 laptop:h-[1.73125rem] laptop:w-[2.15625rem] tablet:h-[1.6375rem] tablet:w-[2.0375rem] mobile:h-[1.45rem] mobile:w-[1.8rem]"
              inset="desktop:inset-[-4.06%_-3.26%] laptop:inset-[-4.06%_-3.26%] tablet:inset-[-4.06%_-3.26%] mobile:inset-[-4.31%_-3.47%]"
            />
          </Rotated>
          <Rotated
            box={`${ABS} desktop:top-9.75 desktop:left-27 desktop:h-9.75 desktop:w-43 laptop:top-12 laptop:left-24 tablet:top-9 tablet:left-20.5`}
            rotate="desktop:-rotate-3"
          >
            <p className="type-script text-eyebrow-sm text-accent-strong">
              {eyebrow}
            </p>
          </Rotated>
        </div>

        <h2 className="type-display text-poster-title desktop:text-on-poster compact:text-on-inverse mobile:flex mobile:w-full mobile:flex-wrap mobile:items-center mobile:justify-center mobile:gap-x-2.25">
          <MotionSlot kind="headline" as="span" className={`${ABS} desktop:top-24 desktop:left-14.5 laptop:top-22.5 laptop:left-11.5 tablet:top-19 tablet:left-8.5`}>
            {title}
          </MotionSlot>
          <span className="mobile:relative mobile:h-12 mobile:w-35.75 mobile:shrink-0">
            <Rotated
              as="span"
              box="absolute desktop:top-15.5 desktop:left-97.5 desktop:h-38.25 desktop:w-93 laptop:top-17.25 laptop:left-71.75 laptop:h-28.75 laptop:w-69.75 tablet:top-15 tablet:left-53.75 tablet:h-21.5 tablet:w-52.5 mobile:-top-1.25 mobile:left-0.5 mobile:h-14.25 mobile:w-35"
              rotate="-rotate-4"
            >
              <MotionSlot kind="mark" as="span" className="type-script text-script-sm text-accent-strong normal-case not-italic compact:-translate-y-[0.04em]">{mark}</MotionSlot>
            </Rotated>
            <Rotated
              as="span"
              box="absolute desktop:top-47.5 desktop:left-98.75 desktop:h-5.5 desktop:w-83.75 laptop:top-40.25 laptop:left-72.75 laptop:h-4.5 laptop:w-62.75 tablet:top-32.25 tablet:left-54.75 tablet:h-3.75 tablet:w-47.25 mobile:top-9.25 mobile:left-1.5 mobile:h-2.75 mobile:w-31.5"
              rotate="-rotate-3"
            >
              <MotionSlot kind="scribble">
                <Vector
                  src="/assets/drop/drop-scribble.svg"
                  sources={{
                    laptop: "/assets/drop/drop-scribble-laptop.svg",
                    tablet: "/assets/drop/drop-scribble-tablet.svg",
                    mobile: "/assets/drop/drop-scribble-mobile.svg",
                  }}
                  size="h-1.25 desktop:w-83.75 laptop:w-62.75 tablet:w-47.25 mobile:w-31.5"
                  inset="desktop:inset-[-74.12%_-1.04%] laptop:inset-[-50.83%_-0.96%] tablet:inset-[-42.35%_-1.06%] mobile:inset-[-42.35%_-1.59%]"
                />
              </MotionSlot>
            </Rotated>
          </span>
        </h2>
      </div>

      <div className="mobile:relative mobile:mx-auto mobile:h-79.75 mobile:w-62.5">
        <Rotated
          box="absolute desktop:top-68.75 desktop:left-97.25 desktop:h-141.5 desktop:w-109.25 laptop:top-55.5 laptop:left-88.75 laptop:h-132.25 laptop:w-102.5 tablet:top-42.5 tablet:left-66.25 tablet:h-99.25 tablet:w-77 mobile:top-1.25 mobile:left-1.25 mobile:h-77.5 mobile:w-60"
          rotate="desktop:rotate-[4.54deg] compact:rotate-4"
          parallax={-10}
        >
          <CardImage
            {...card}
            size="desktop:h-134 desktop:w-99 desktop:rounded-art-2xl laptop:h-126 laptop:w-94 laptop:rounded-art-xl tablet:h-94.5 tablet:w-70.5 tablet:rounded-2xl mobile:h-73.75 mobile:w-55 mobile:rounded-xl compact:shadow-card"
            designWidth={396}
            crop="top-[-2.24%] left-[-4.55%] h-[110.45%] w-[114.14%]"
          />
        </Rotated>
      </div>

      <ul className="mobile:flex mobile:w-full mobile:flex-col mobile:gap-5">
        {points.map((point, i) => (
          <li key={point} className="mobile:flex mobile:items-start mobile:gap-3">
            <Rotated box={`${ABS} ${POINTS[i].bullet}`} rotate="desktop:rotate-90">
              <Vector
                src="/assets/drop/drop-bullet.svg"
                sources={{
                  laptop: "/assets/drop/drop-bullet-compact.svg",
                  mobile: "/assets/drop/drop-bullet-mobile.svg",
                }}
                size="desktop:h-2 desktop:w-2.25 laptop:h-2.75 laptop:w-2.25 tablet:h-2.75 tablet:w-2.25 mobile:h-5.5 mobile:w-2.5"
                inset="desktop:inset-[0_6.7%_25%_6.7%] laptop:inset-[-4.55%_-5.56%] tablet:inset-[-4.55%_-5.56%] mobile:inset-[0_0_0_-5%]"
              />
            </Rotated>
            <MotionSlot
              kind="copy"
              as="p"
              index={i}
              className={`text-poster-copy leading-poster desktop:text-on-poster/85 laptop:text-on-inverse/88 tablet:text-on-inverse/88 mobile:flex-1 mobile:text-on-inverse/85 ${ABS} ${POINTS[i].text}`}
            >
              {point}
            </MotionSlot>
          </li>
        ))}
      </ul>

      <p
        className={`type-caps text-poster-meta tracking-nav whitespace-pre desktop:leading-meta desktop:text-on-poster compact:text-on-inverse ${ABS} desktop:top-188 desktop:left-16 laptop:top-178.25 laptop:left-22 tablet:top-132.75 tablet:left-16.5`}
      >
        {shelf}
        <span className="text-accent-strong">{price}</span>
      </p>
    </div>

    {ARCS.map((arc) => (
      <Rotated key={arc.box} box={`pointer-events-none absolute ${arc.box}`} rotate={arc.rotate} parallax={arc.parallax}>
        <div className={`relative drop-shadow-wire ${arc.size}`}>
          <Image src="/assets/drop/drop-barbed-wire-arc.png" alt="" fill sizes="80vw" className="object-contain" />
        </div>
      </Rotated>
    ))}
  </section>
);
