import { Rotated } from "@/components/ui/rotated";
import { MotionSlot } from "@/components/motion/motion-slot";

export interface RecordLedgerProps {
  rows: ReadonlyArray<{ date: string; title: string; ref: string; stamp: string }>;
}

/**
 * Stamp tilt + rotated bounding box per row. Figma lays the compact rows out
 * around the stamp's rotated bbox, so its size sets each row's height.
 */
const STAMP = [
  {
    rotate: "desktop:rotate-7 compact:rotate-6",
    box: "laptop:h-12.5 laptop:w-24.5 tablet:h-12.5 tablet:w-24.5 mobile:h-11.75 mobile:w-23",
  },
  {
    rotate: "-rotate-4",
    box: "laptop:h-12 laptop:w-28 tablet:h-12 tablet:w-28 mobile:h-11.25 mobile:w-26.25",
  },
  {
    rotate: "rotate-3",
    box: "laptop:h-11.25 laptop:w-24.25 tablet:h-11.25 tablet:w-24.25 mobile:h-10.75 mobile:w-22.75",
  },
  {
    rotate: "desktop:-rotate-6 compact:-rotate-5",
    box: "laptop:h-12 laptop:w-24.25 tablet:h-12 tablet:w-24.25 mobile:h-11.5 mobile:w-23",
  },
] as const;

/** Audit log rows of Figma "Record" — four layouts, one list. */
export const RecordLedger = ({ rows }: RecordLedgerProps) => (
  <ul className="w-full border-t border-foreground/16 desktop:absolute desktop:top-246.5 desktop:left-21 desktop:w-308">
    {rows.map((row, i) => (
      <MotionSlot
        kind="ledger"
        as="li"
        index={i}
        key={row.ref}
        className="relative border-b border-foreground/16 desktop:h-21 laptop:flex laptop:items-center laptop:gap-5 laptop:py-5 tablet:flex tablet:items-center tablet:gap-5 tablet:py-5 mobile:grid mobile:grid-cols-[1fr_auto] mobile:items-center mobile:gap-y-2.5 mobile:py-4.5"
      >
        <span className="type-caps text-row-date tracking-nav text-accent desktop:absolute desktop:top-7.25 desktop:left-0 laptop:w-30 laptop:shrink-0 tablet:w-25 tablet:shrink-0 mobile:col-start-1 mobile:row-start-1">
          {row.date}
        </span>
        <span className="type-caps text-row-title tracking-row text-foreground desktop:absolute desktop:top-6.75 desktop:left-39 compact:leading-row compact:whitespace-normal laptop:flex-1 tablet:flex-1 mobile:col-span-2 mobile:row-start-2">
          {row.title}
        </span>
        <span className="type-caps text-meta tracking-caps text-foreground-subtle desktop:absolute desktop:top-7.75 desktop:right-46.5 laptop:shrink-0 tablet:hidden mobile:col-span-2 mobile:row-start-3">
          {row.ref}
        </span>
        <Rotated
          as="span"
          box={`desktop:absolute desktop:top-1/2 desktop:left-290.5 desktop:-translate-1/2 compact:shrink-0 mobile:col-start-2 mobile:row-start-1 mobile:justify-self-end ${STAMP[i].box}`}
          rotate={STAMP[i].rotate}
        >
          <MotionSlot
            kind="stamp"
            as="span"
            index={i}
            className="type-display block rounded-md border-3 border-accent text-stamp text-accent desktop:h-11 desktop:pt-1.5 desktop:pr-2.75 desktop:pl-3.25 desktop:opacity-90! compact:px-3.5 compact:py-1.5">
            {row.stamp}
          </MotionSlot>
        </Rotated>
      </MotionSlot>
    ))}
  </ul>
);
