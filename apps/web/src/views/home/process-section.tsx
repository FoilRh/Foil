import { Eyebrow } from "@/components/ui/eyebrow";
import { GhostWord } from "@/components/ui/ghost-word";
import { Rotated } from "@/components/ui/rotated";
import { Vector } from "@/components/ui/vector";
import type { Stat } from "@/data/mocks/home";

import { ProcessStep } from "./process-step";
import { MotionSlot } from "@/components/motion/motion-slot";

export interface ProcessSectionProps {
  eyebrow: string;
  titleLine1: string;
  titleLine2: string;
  struck: string;
  mark: string;
  ghost: string;
  steps: ReadonlyArray<{ number: string; title: string; text: string; stats: readonly Stat[] }>;
}

/** Desktop bounding box + tilt of each step card, in Figma order. */
const STEP_LAYOUT = [
  { box: "desktop:top-130 desktop:left-19 desktop:h-102.75 desktop:w-77.75", rotate: "desktop:rotate-[2.2deg]" },
  { box: "desktop:top-134 desktop:left-97.75 desktop:h-101.75 desktop:w-76.5", rotate: "desktop:rotate-[-1.4deg]" },
  { box: "desktop:top-130.75 desktop:left-176 desktop:h-101.5 desktop:w-76", rotate: "desktop:rotate-[1.2deg]" },
  { box: "desktop:top-133.5 desktop:left-253 desktop:h-103 desktop:w-78", rotate: "desktop:rotate-[-2.4deg]" },
] as const;

const SCRIBBLE_1 = {
  laptop: "/assets/process/process-scribble-1-laptop.svg",
  tablet: "/assets/process/process-scribble-1-tablet.svg",
  mobile: "/assets/process/process-scribble-1-mobile.svg",
};
const SCRIBBLE_2 = {
  laptop: "/assets/process/process-scribble-2-laptop.svg",
  tablet: "/assets/process/process-scribble-2-tablet.svg",
  mobile: "/assets/process/process-scribble-2-mobile.svg",
};

/** Figma "Process": 1400 5162:14547 · 1024 5249:613 · 768 5249:1004 · 390 5249:1359. */
export const ProcessSection = ({
  eyebrow,
  titleLine1,
  titleLine2,
  struck,
  mark,
  ghost,
  steps,
}: ProcessSectionProps) => (
  <section
    id="process"
    className="relative overflow-clip desktop:h-259 desktop:bg-background compact:flex compact:flex-col laptop:gap-16 laptop:px-8 laptop:pt-12 laptop:pb-18 tablet:gap-12 tablet:px-10 tablet:pt-10 tablet:pb-15 mobile:gap-10 mobile:px-5 mobile:pt-8 mobile:pb-12 mobile:mx-auto mobile:max-w-97.5"
  >
    <GhostWord
      word={ghost}
      box="desktop:top-14 desktop:left-150.75 desktop:h-104.75 desktop:w-256.5 laptop:top-2.5 laptop:left-51.5 laptop:h-83.75 laptop:w-205 tablet:top-2.5 tablet:left-28.5 tablet:h-66.5 tablet:w-162.25 mobile:hidden"
      rotate="rotate-7"
      size="text-ghost-sm"
    />

    <div className="relative flex flex-col desktop:static desktop:block laptop:gap-3 tablet:gap-3 mobile:items-center mobile:gap-2.5">
      <Eyebrow
        label={eyebrow}
        crownBox="desktop:top-27 desktop:left-20 desktop:h-9 desktop:w-10.5"
        labelBox="desktop:top-23.25 desktop:left-35 desktop:h-10.75 desktop:w-42"
      />

      <h2 className="type-display flex w-full flex-col text-display text-foreground desktop:block mobile:items-center">
        <MotionSlot kind="headline" as="span" index={0} className="block desktop:absolute desktop:top-41.5 desktop:left-21 laptop:-mb-3.25 tablet:-mb-2.5 mobile:-mb-1.75 mobile:text-center">
          {titleLine1}
        </MotionSlot>
        <span className="flex flex-wrap items-center desktop:block laptop:gap-x-4.25 tablet:gap-x-3.25 mobile:justify-center mobile:gap-x-2.25">
          <MotionSlot kind="headline" as="span" index={1} className="desktop:absolute desktop:top-73.75 desktop:left-21">{titleLine2}</MotionSlot>

          <span className="relative shrink-0 desktop:static laptop:h-24 laptop:w-77.5 tablet:h-18 tablet:w-58.25 mobile:h-12 mobile:w-38.75">
            <MotionSlot kind="headline" as="s" index={1} className="absolute top-0 left-0 text-foreground/28 no-underline desktop:top-73.75 desktop:left-122.75">{struck}</MotionSlot>
            <Rotated
              as="span"
              box="absolute desktop:top-89.25 desktop:left-120.25 desktop:h-5.5 desktop:w-124.5 laptop:top-10 laptop:-left-1.5 laptop:h-4 laptop:w-80 tablet:top-7.5 tablet:-left-1.5 tablet:h-3.25 tablet:w-60.75 mobile:top-5 mobile:-left-1.5 mobile:h-2.5 mobile:w-41.25"
              rotate="rotate-2"
            >
              <MotionSlot kind="scribble">
                <Vector
                  src="/assets/process/process-scribble-1.svg"
                  sources={SCRIBBLE_1}
                  size="h-1.25 desktop:w-124.5 laptop:w-80 tablet:w-60.75 mobile:w-41.25"
                  inset="desktop:inset-[-95.3%_-0.9%] laptop:inset-[-60.99%_-0.9%] tablet:inset-[-45.74%_-0.89%] mobile:inset-[-42.35%_-1.21%]"
                />
              </MotionSlot>
            </Rotated>
            <Rotated
              as="span"
              box="absolute desktop:top-92.75 desktop:left-121.75 desktop:h-3.25 desktop:w-121 laptop:top-12 laptop:left-0 laptop:h-2.5 laptop:w-76.5 tablet:top-9 tablet:left-0 tablet:h-2.25 tablet:w-57.25 mobile:top-6 mobile:left-0 mobile:h-1.75 mobile:w-37.75"
              rotate="-rotate-1"
            >
              <MotionSlot kind="scribble">
                <Vector
                  src="/assets/process/process-scribble-2.svg"
                  sources={SCRIBBLE_2}
                  size="h-1.25 desktop:w-121 laptop:w-76.5 tablet:w-57.25 mobile:w-37.75"
                  inset="desktop:inset-[-63.54%_-0.62%] laptop:inset-[-40.66%_-0.63%] tablet:inset-[-31.77%_-0.66%] mobile:inset-[-31.76%_-0.99%]"
                />
              </MotionSlot>
            </Rotated>
          </span>

          <span className="relative shrink-0 desktop:static laptop:h-24 laptop:w-59 tablet:h-18 tablet:w-44.75 mobile:h-12 mobile:w-20">
            <Rotated
              as="span"
              box="absolute desktop:top-60 desktop:left-245 desktop:h-45.25 desktop:w-92.75 laptop:-top-2.5 laptop:left-0.5 laptop:h-29 laptop:w-59.5 tablet:-top-2 tablet:left-0.5 tablet:h-21.75 tablet:w-44.75 mobile:-top-1.25 mobile:left-0.5 mobile:h-14.5 mobile:w-29.75"
              rotate="-rotate-5"
            >
              <MotionSlot kind="mark" as="span" className="type-script text-script-md text-accent normal-case not-italic compact:-translate-y-[0.04em]">{mark}</MotionSlot>
            </Rotated>
          </span>
        </span>
      </h2>
    </div>

    <ol className="flex flex-wrap desktop:block laptop:gap-4 tablet:gap-4 mobile:gap-3">
      {steps.map((step, i) => (
        <li key={step.number}>
          <Rotated
            box={`relative desktop:absolute ${STEP_LAYOUT[i].box}`}
            rotate={STEP_LAYOUT[i].rotate}
          >
            <ProcessStep {...step} variant={i % 2 === 0 ? "a" : "b"} index={i} />
          </Rotated>
        </li>
      ))}
    </ol>
  </section>
);
