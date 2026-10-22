import Image from "next/image";

import { Rotated } from "@/components/ui/rotated";
import { cx } from "@/utils/cx";

export interface BarbedWireProps {
  /** Bounding box of the strand per breakpoint (Figma frame offsets). */
  box: string;
  /** Size of the un-rotated strand image on mobile (vw, exact at 390). */
  mobileSize: string;
  /** Scroll parallax travel in rem (see `Parallax`). */
  parallax?: number;
}

/**
 * Figma "Barbed wire". Desktop: a strand straddling two sections, so it lives
 * in a zero-height layer between them. Compact: its own band (225 / 169 /
 * 86px tall at 1024 / 768 / 390) — not clipped, so the strand stays whole as
 * it drifts with the parallax (`<main>` clips the horizontal overflow). On mobile the strand is sized
 * in vw — equal to the 390 frame at 390px — so it stays full-bleed on wider
 * phones where the content column stops growing.
 */
export const BarbedWire = ({ box, mobileSize, parallax }: BarbedWireProps) => (
  <div
    aria-hidden
    className="pointer-events-none relative z-20 desktop:h-0 laptop:h-56.25 tablet:h-42.25 mobile:h-[22.051vw]"
  >
    <Rotated box={cx("absolute", box)} rotate="-scale-y-100 rotate-[-88.17deg]" parallax={parallax}>
      <div
        className={cx(
          "relative desktop:h-404.5 desktop:w-124.75 laptop:h-296 laptop:w-91.25 tablet:h-222 tablet:w-68.5",
          mobileSize,
        )}
      >
        <Image
          src="/assets/shared/barbed-wire-strand.png"
          alt=""
          fill
          // The strand's own (un-rotated) width: 35.6vw on every frame, 40.4vw on
          // phones. `100vw` sent phones a 1280×4150 decode for a 160 px strand.
          sizes="(width < 700px) 41vw, 36vw"
          className="object-fill"
        />
      </div>
    </Rotated>
  </div>
);
