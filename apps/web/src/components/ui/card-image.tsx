import Image from "next/image";

import { cx } from "@/utils/cx";
import { MotionSlot } from "@/components/motion/motion-slot";

export interface CardImageProps {
  src: string;
  alt: string;
  /** Card box size (Figma layer width/height), per breakpoint. */
  size: string;
  /** Largest rendered width in design px — feeds `sizes` for next/image. */
  designWidth: number;
  /** Figma crop of the fill inside the card (`top-… left-… h-… w-…` in %). */
  crop?: string;
  className?: string;
  imageClassName?: string;
  /** Position in its group — staggers the reveal. */
  index?: number;
}

/** A collectible card image, sized and cropped like its Figma layer. */
export const CardImage = ({
  src,
  alt,
  size,
  designWidth,
  crop,
  className,
  imageClassName = "object-contain",
  index = 0,
}: CardImageProps) => {
  const sizes = `${Math.round((designWidth / 1400) * 100)}vw`;
  return (
    // Motion lives on a wrapper so the card's own opacity (the faded fan cards)
    // multiplies with the reveal instead of being overwritten by it.
    <MotionSlot kind="card" as="div" index={index} className="w-fit">
      <div className={cx("relative overflow-hidden", size, className)}>
        {crop ? (
          <div className="absolute inset-0">
            {/* `object-cover`: the Figma crop box is ~1 % off the art's ratio, and a
                stretched `object-fill` image fails Best Practices' aspect check. */}
            <Image src={src} alt={alt} fill loading="eager" sizes={sizes} className="object-contain" />
          </div>
        ) : (
          <Image src={src} alt={alt} fill loading="eager" sizes={sizes} className={imageClassName} />
        )}
      </div>
    </MotionSlot>
  );
};
