import { Rotated } from "@/components/ui/rotated";
import { Vector } from "@/components/ui/vector";
import type { Stat } from "@/data/mocks/home";
import { MotionSlot } from "@/components/motion/motion-slot";

export interface RecordStickersProps {
  insured: Stat;
  vaulted: Stat;
  audits: Stat;
  lost: Stat;
}

const LABEL = "type-caps absolute text-meta desktop:tracking-caps compact:tracking-address";
const VALUE = "type-display absolute";

/**
 * The four stat "stickers" + crown of Figma "Record". Desktop boxes are
 * section-relative; compact boxes sit in a fixed-height row (245 / 234 / 334).
 */
export const RecordStickers = ({ insured, vaulted, audits, lost }: RecordStickersProps) => (
  <div className="relative w-full desktop:static laptop:h-61.25 tablet:h-58.5 mobile:h-83.5">
    <Rotated
      box="absolute desktop:top-155 desktop:left-19.5 desktop:h-60 desktop:w-111 laptop:top-8.75 laptop:-left-1.25 laptop:h-44.25 laptop:w-78.75 tablet:top-13.25 tablet:-left-1 tablet:h-33 tablet:w-55.25 mobile:top-6.25 mobile:-left-0.75 mobile:h-28.25 mobile:w-49"
      rotate="rotate-4"
    >
      <MotionSlot kind="sticker" as="div" index={0} className="relative desktop:h-52.5 desktop:w-107.5 laptop:h-39 laptop:w-76.25 tablet:h-29.25 tablet:w-53.25 mobile:h-25 mobile:w-47.5">
        <div className="absolute bg-accent desktop:top-2.5 desktop:left-2.5 desktop:h-50 desktop:w-105 laptop:top-2 laptop:left-2 laptop:h-37 laptop:w-74.25 tablet:top-1.5 tablet:left-1.5 tablet:h-27.75 tablet:w-51.75 mobile:top-1.25 mobile:left-1.25 mobile:h-23.75 mobile:w-46.25" />
        <div className="absolute top-0 left-0 bg-surface-inverse desktop:h-50 desktop:w-105 laptop:h-37 laptop:w-74.25 tablet:h-27.75 tablet:w-51.75 mobile:h-23.75 mobile:w-46.25" />
        <p className={`${LABEL} text-on-inverse/70 desktop:top-5.5 desktop:left-6.5 laptop:top-5 laptop:left-5 tablet:top-4 tablet:left-4 mobile:top-3.5 mobile:left-3.5`}>
          {insured.label}
        </p>
        <p className={`${VALUE} text-stat text-on-inverse desktop:top-12.5 desktop:left-5.5 laptop:top-10.5 laptop:left-4.5 tablet:top-9.25 tablet:left-3.5 mobile:top-8.25 mobile:left-3`}>
          {insured.value}
        </p>
      </MotionSlot>
    </Rotated>

    <Rotated
      box="absolute desktop:top-146.25 desktop:left-136 desktop:h-62.5 desktop:w-98 laptop:top-6.25 laptop:left-79 laptop:h-40.5 laptop:w-69 tablet:top-11.25 tablet:left-50.25 tablet:h-30.25 tablet:w-48.5 mobile:top-4.75 mobile:left-45.25 mobile:h-26 mobile:w-43"
      rotate="-rotate-3"
    >
      <MotionSlot kind="sticker" as="div" index={1} className="relative bg-accent desktop:h-57.5 desktop:w-95 laptop:h-37 laptop:w-67.25 tablet:h-27.75 tablet:w-47 mobile:h-23.75 mobile:w-41.75">
        <p className={`${LABEL} text-on-inverse/75 desktop:top-6 desktop:left-6.5 laptop:top-5 laptop:left-5 tablet:top-4 tablet:left-4 mobile:top-3.5 mobile:left-3.5`}>
          {vaulted.label}
        </p>
        <p className={`${VALUE} text-stat-lg text-on-inverse desktop:top-15 desktop:left-5 laptop:top-10.5 laptop:left-4.5 tablet:top-9.25 tablet:left-3.5 mobile:top-8.25 mobile:left-3`}>
          {vaulted.value}
        </p>
      </MotionSlot>
    </Rotated>

    <Rotated
      box="absolute desktop:top-169.75 desktop:left-231.25 desktop:h-55.5 desktop:w-62.75 laptop:top-12.75 laptop:left-150 laptop:h-39.25 laptop:w-43.75 tablet:top-16 tablet:left-95 tablet:h-29.5 tablet:w-36.75 mobile:top-47 mobile:-left-0.5 mobile:h-25.5 mobile:w-35.5"
      rotate="rotate-3"
    >
      <MotionSlot kind="sticker" as="div" index={2} className="relative desktop:h-52.5 desktop:w-60 laptop:h-37 laptop:w-41.75 tablet:h-27.75 tablet:w-35.25 mobile:h-23.75 mobile:w-34.25">
        <div className="absolute inset-0 border-2 border-border-strong bg-surface desktop:rounded-sticker compact:rounded-xl" />
        <p className={`${LABEL} text-foreground-subtle desktop:top-6 desktop:left-6 laptop:top-5 laptop:left-5 tablet:top-4 tablet:left-4 mobile:top-3.5 mobile:left-3.5`}>
          {audits.label}
        </p>
        <p className={`${VALUE} text-7xl compact:text-5xl mobile:text-4xl text-accent desktop:top-24 desktop:left-5.5 laptop:top-10.5 laptop:left-4.5 tablet:top-9.25 tablet:left-3.5 mobile:top-8.25 mobile:left-3`}>
          {audits.value}
        </p>
      </MotionSlot>
    </Rotated>

    <Rotated
      box="absolute desktop:top-108.25 desktop:left-269.25 desktop:size-71.5 laptop:-top-4 laptop:left-188.75 laptop:size-58.75 tablet:top-2.25 tablet:left-125.75 tablet:size-49.25 mobile:top-30.25 mobile:left-31.75 mobile:size-51"
      rotate="desktop:-rotate-9 laptop:rotate-9 tablet:-rotate-8 mobile:rotate-9"
    >
      <MotionSlot kind="sticker" as="div" index={3} className="relative desktop:size-62.5 laptop:size-51.25 tablet:size-43.5 mobile:size-44.5">
        <Vector
          src="/assets/record/record-ring-outer.svg"
          sources={{
            laptop: "/assets/record/record-ring-outer-laptop.svg",
            tablet: "/assets/record/record-ring-outer-tablet.svg",
            mobile: "/assets/record/record-ring-outer-mobile.svg",
          }}
          size="absolute! inset-0"
        />
        <Vector
          src="/assets/record/record-ring-inner.png"
          sources={{
            laptop: "/assets/record/record-ring-inner-laptop.png",
            tablet: "/assets/record/record-ring-inner-tablet.png",
            mobile: "/assets/record/record-ring-inner-mobile.png",
          }}
          size="absolute! desktop:top-3.5 desktop:left-3.5 desktop:size-55.5 laptop:top-2.75 laptop:left-2.75 laptop:size-45.75 tablet:top-2.5 tablet:left-2.5 tablet:size-38.5 mobile:top-2.75 mobile:left-2.75 mobile:size-39"
        />
        <p className={`${VALUE} inset-x-0 top-1/4 text-center text-7xl compact:text-5xl text-foreground`}>
          {lost.value}
        </p>
        <p className="type-caps absolute inset-x-0 top-3/4 text-center text-fine text-accent tracking-caps">
          {lost.label}
        </p>
      </MotionSlot>
    </Rotated>

    <Rotated
      box="absolute desktop:top-140 desktop:left-127.75 desktop:h-13 desktop:w-14.75 laptop:-top-1.5 laptop:left-74.75 laptop:h-11 laptop:w-12.5 tablet:-top-2 tablet:left-46.75 tablet:h-9.25 tablet:w-10.5 mobile:-top-1.5 mobile:left-42.75 mobile:h-6.5 mobile:w-7.5"
      rotate="rotate-12"
    >
      <Vector
        src="/assets/record/record-crown.svg"
        sources={{
          laptop: "/assets/record/record-crown-laptop.svg",
          tablet: "/assets/record/record-crown-tablet.svg",
          mobile: "/assets/record/record-crown-mobile.svg",
        }}
        size="desktop:h-10.5 desktop:w-13 laptop:h-8.75 laptop:w-11 tablet:h-7.5 tablet:w-9.25 mobile:h-5.25 mobile:w-6.5"
        inset="desktop:inset-[-4.05%_-3.26%] laptop:inset-[-4.06%_-3.27%] tablet:inset-[-4.05%_-3.26%] mobile:inset-[-4.81%_-3.88%]"
      />
    </Rotated>
  </div>
);
