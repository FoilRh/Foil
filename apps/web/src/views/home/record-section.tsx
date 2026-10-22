import { Eyebrow } from "@/components/ui/eyebrow";
import { GhostWord } from "@/components/ui/ghost-word";
import { Rotated } from "@/components/ui/rotated";
import { Vector } from "@/components/ui/vector";
import type { Stat } from "@/data/mocks/home";

import { RecordLedger } from "./record-ledger";
import { RecordStickers } from "./record-stickers";
import { MotionSlot } from "@/components/motion/motion-slot";

export interface RecordSectionProps {
  eyebrow: string;
  ghost: string;
  titleLine1: string;
  titleLine2: string;
  mark: string;
  insured: Stat;
  vaulted: Stat;
  audits: Stat;
  lost: Stat;
  log: ReadonlyArray<{ date: string; title: string; ref: string; stamp: string }>;
}

/** Figma "Record": 1400 5222:548 · 1024 5249:729 · 768 5249:1120 · 390 5249:1469. */
export const RecordSection = ({
  eyebrow,
  ghost,
  titleLine1,
  titleLine2,
  mark,
  log,
  ...stats
}: RecordSectionProps) => (
  <section id="record" className="relative overflow-clip desktop:h-354 desktop:bg-background compact:flex compact:flex-col laptop:gap-12 laptop:px-8 laptop:pt-9.5 laptop:pb-18 tablet:gap-10 tablet:px-10 tablet:pt-8 tablet:pb-15 mobile:gap-8 mobile:px-5 mobile:pt-6.5 mobile:pb-12 mobile:mx-auto mobile:max-w-97.5">
    <GhostWord
      word={ghost}
      box="desktop:top-16.5 desktop:left-156 desktop:h-99.75 desktop:w-214.5 laptop:top-2.5 laptop:left-85 laptop:h-79.75 laptop:w-171.75 tablet:top-2.5 tablet:left-28 tablet:h-63.25 tablet:w-136 mobile:hidden"
      rotate="rotate-7"
      size="text-ghost-sm"
    />

    <div className="relative flex flex-col desktop:static desktop:block laptop:items-start laptop:gap-3 tablet:items-center tablet:gap-3 mobile:items-center mobile:gap-2.5">
      <Eyebrow
        label={eyebrow}
        crownBox="desktop:top-37 desktop:left-20 desktop:h-9 desktop:w-10.5"
        labelBox="desktop:top-33 desktop:left-35 desktop:h-11 desktop:w-47.5"
      />
      <h2 className="type-display flex w-full flex-col text-display text-foreground desktop:block handheld:items-center">
        <MotionSlot kind="headline" as="span" index={0} className="block desktop:absolute desktop:top-51.5 desktop:left-21 laptop:-mb-3.25 tablet:-mb-2.5 mobile:-mb-1.75 handheld:text-center">
          {titleLine1}
        </MotionSlot>
        <span className="flex flex-wrap items-center desktop:block laptop:gap-x-4.25 tablet:gap-x-3.25 mobile:gap-x-2.25 handheld:justify-center">
          <MotionSlot kind="headline" as="span" index={1} className="desktop:absolute desktop:top-83.75 desktop:left-21">{titleLine2}</MotionSlot>
          <span className="relative shrink-0 desktop:static laptop:h-24.5 laptop:w-69.25 tablet:h-18.25 tablet:w-52 mobile:h-12.25 mobile:w-35.5">
            <Rotated
              as="span"
              box="absolute desktop:top-74.5 desktop:left-123.5 desktop:h-45.5 desktop:w-108.25 laptop:-top-2.25 laptop:left-0.5 laptop:h-29.25 laptop:w-69.25 tablet:-top-1.75 tablet:left-0.5 tablet:h-21.75 tablet:w-51.75 mobile:-top-1.25 mobile:left-0.5 mobile:h-14.5 mobile:w-34.75"
              rotate="-rotate-4"
            >
              <MotionSlot kind="mark" as="span" className="type-script text-script-lg text-accent normal-case not-italic compact:-translate-y-[0.04em]">{mark}</MotionSlot>
            </Rotated>
            <Rotated
              as="span"
              box="absolute desktop:top-112.5 desktop:left-125.25 desktop:h-6.25 desktop:w-97.25 laptop:top-18.75 laptop:left-1.5 laptop:h-4.5 laptop:w-62.25 tablet:top-14 tablet:left-1.5 tablet:h-3.5 tablet:w-46.5 mobile:top-9.5 mobile:left-1.5 mobile:h-2.75 mobile:w-31.25"
              rotate="-rotate-3"
            >
              <MotionSlot kind="scribble">
                <Vector
                  src="/assets/record/record-scribble.svg"
                  sources={{
                    laptop: "/assets/record/record-scribble-laptop.svg",
                    tablet: "/assets/record/record-scribble-tablet.svg",
                    mobile: "/assets/record/record-scribble-mobile.svg",
                  }}
                  size="h-1.25 desktop:w-97.25 laptop:w-62.25 tablet:w-46.5 mobile:w-31.25"
                  inset="desktop:inset-[-74.13%_-0.9%] laptop:inset-[-51.89%_-0.98%] tablet:inset-[-42.35%_-1.08%] mobile:inset-[-42.35%_-1.6%]"
                />
              </MotionSlot>
            </Rotated>
          </span>
        </span>
      </h2>
    </div>

    <RecordStickers {...stats} />
    <RecordLedger rows={log} />
  </section>
);
