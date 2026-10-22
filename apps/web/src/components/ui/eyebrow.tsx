import { Rotated } from "@/components/ui/rotated";
import {PixelIcon} from "./pixel-icon";
import { cx } from "@/utils/cx";

export interface EyebrowProps {
  label: string;
  /** Desktop bounding box of the tilted crown (`desktop:` utilities). */
  crownBox: string;
  /** Desktop bounding box of the tilted script label (`desktop:` utilities). */
  labelBox: string;
  className?: string;
}

/**
 * Section eyebrow: crown + hand-written accent label. Desktop scatters both as
 * tilted layers; the compact frames set them upright in a row.
 */
export const Eyebrow = ({ label, crownBox, labelBox, className }: EyebrowProps) => (
  <div className={cx("flex items-center gap-3 desktop:contents", className)}>
    <Rotated box={cx("relative shrink-0 desktop:absolute", crownBox)} rotate="desktop:rotate-8">
      <PixelIcon name="crown" className="text-accent desktop:h-9 desktop:w-10.5 laptop:h-7 laptop:w-9 tablet:h-7 tablet:w-9 mobile:h-6 mobile:w-7"/>
    </Rotated>
    <Rotated box={cx("relative desktop:absolute", labelBox)} rotate="desktop:-rotate-3">
      <p className="type-script text-eyebrow text-accent">{label}</p>
    </Rotated>
  </div>
);
