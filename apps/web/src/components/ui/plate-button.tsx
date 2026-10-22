import {PixelIcon} from "./pixel-icon";
import { cx } from "@/utils/cx";
import { MotionSlot } from "@/components/motion/motion-slot";

/** Drip `left-*` offsets per breakpoint; compact drips share one size ramp. */
export interface PlateDrips {
  /** Full utility strings (position + size) for the desktop frame. */
  desktop: readonly string[];
  laptop?: readonly string[];
  tablet?: readonly string[];
  mobile?: readonly string[];
  /** Used for every compact breakpoint without its own list. */
  compact?: readonly string[];
}

export interface PlateButtonProps {
  label: string;
  href?: string;
  type?: "submit" | "button";
  /** `md` — page CTA; `sm` — header "Buy NFT". */
  size?: "md" | "sm";
  /** Plate width per breakpoint — the Figma plate width for this label. */
  plateWidth: string;
  drips: PlateDrips;
  className?: string;
}

const SIZES = {
  md: {
    root: "desktop:h-16.25 desktop:pr-1.75 laptop:h-15.5 laptop:pr-1.5 handheld:h-14.5 handheld:pr-1.5",
    plate:
      "text-button desktop:h-14.5 desktop:px-6.5 laptop:h-14 laptop:px-5.5 handheld:h-13 handheld:px-5.5",
    offset:
      "desktop:top-1.75 desktop:left-1.75 desktop:h-14.5 laptop:top-1.5 laptop:left-1.5 laptop:h-14 handheld:top-1.5 handheld:left-1.5 handheld:h-13",
    drip: "desktop:top-15.75 laptop:top-15 handheld:top-14",
  },
  sm: {
    root: "desktop:h-12.25 desktop:pr-1.25 compact:h-11.5 compact:pr-1.5",
    plate: "text-button-sm desktop:h-11 desktop:pr-4 desktop:pl-4.5 compact:h-10 compact:px-5.5",
    offset: "desktop:top-1.25 desktop:left-1.25 desktop:h-11 compact:top-1.5 compact:left-1.5 compact:h-10",
    drip: "desktop:top-11.75 compact:top-11",
  },
} as const;

/** Every compact frame draws the same seven drips, only their offsets move. */
const COMPACT_DRIP_SIZE = [
  "h-4.5 w-1.5",
  "h-2.5 w-1",
  "h-7.5 w-1.75",
  "h-3.25 w-1",
  "h-5.5 w-1.5",
  "h-2 w-1",
  "h-4 w-1.75",
] as const;

/**
 * Hover / keyboard focus inverts the plate: the plate takes the accent, the
 * offset and drips turn light, the label and arrow go white. Discrete colour
 * change, so a token-timed CSS transition (ADR-0014), not a spring.
 */
const SWAP = "transition-[background-color,color,filter] duration-[var(--duration-hover)] ease-entrance";
const HOVER_PAINT = "group-hover:bg-surface-inverse group-focus-visible:bg-surface-inverse";

const DRIP_RANGE = {
  laptop: "hidden laptop:block",
  tablet: "hidden tablet:block",
  mobile: "hidden mobile:block",
  compact: "hidden compact:block",
} as const;

/**
 * The "RS Button" from the Figma frames: a light plate over an accent offset,
 * black-italic label, arrow, and accent paint drips running off the bottom.
 * Inverts its colours on hover / focus (see `SWAP`).
 */
export const PlateButton = ({
  label,
  href,
  type,
  size = "md",
  plateWidth,
  drips,
  className,
}: PlateButtonProps) => {
  const s = SIZES[size];
  const compactSets = (["laptop", "tablet", "mobile", "compact"] as const).filter(
    (range) => drips[range],
  );
  return (
    <MotionSlot kind="button" as={type ? "button" : "a"} href={href} {...(type ? {type} : {})} className={cx("group relative block w-fit", s.root, className)}>
      <span aria-hidden className={cx("absolute bg-accent", SWAP, HOVER_PAINT, s.offset, plateWidth)} />
      {drips.desktop.map((drip, i) => (
        <MotionSlot
          kind="drip"
          as="span"
          index={i}
          key={`d-${drip}`}
          aria-hidden
          className={cx("absolute hidden rounded-b-full bg-accent desktop:block", SWAP, HOVER_PAINT, s.drip, drip)}
        />
      ))}
      {compactSets.map((range) =>
        drips[range]?.map((left, i) => (
          <MotionSlot
            kind="drip"
            as="span"
            index={i}
            key={`${range}-${left}`}
            aria-hidden
            className={cx(
              "absolute rounded-b-full bg-accent",
              SWAP,
              HOVER_PAINT,
              DRIP_RANGE[range],
              s.drip,
              COMPACT_DRIP_SIZE[i],
              left,
            )}
          />
        )),
      )}
      <span
        className={cx(
          "type-display relative flex items-center justify-between bg-surface-inverse text-on-inverse",
          SWAP,
          "group-hover:bg-accent group-hover:text-foreground group-focus-visible:bg-accent group-focus-visible:text-foreground",
          s.plate,
          plateWidth,
        )}
      >
        {label}
        <PixelIcon name="arrow" className="h-4 desktop:w-6.5 compact:w-6"/>
      </span>
    </MotionSlot>
  );
};
