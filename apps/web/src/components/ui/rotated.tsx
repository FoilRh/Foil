import type { ReactNode } from "react";

import { Parallax } from "@/components/motion/parallax";
import { cx } from "@/utils/cx";

export interface RotatedProps {
  /** Position + size of the rotated layer's bounding box, per breakpoint. */
  box: string;
  /** Rotation utilities applied to the content, e.g. `-rotate-3`. */
  rotate?: string;
  children: ReactNode;
  /** `span` when the rotated layer sits inside phrasing content (a heading). */
  as?: "div" | "span";
  className?: string;
  /**
   * Scroll parallax travel in rem (see `Parallax`). Applied to the un-rotated
   * box, so the layer drifts straight up/down whatever its tilt.
   */
  parallax?: number;
  /**
   * Rotation in degrees that accompanies the parallax (see `Parallax`'s
   * `tilt`). Defaults to a light tilt proportional to the travel
   * (`PARALLAX_TILT` deg per rem); pass 0 to keep the layer upright.
   */
  parallaxTilt?: number;
}

/** Default tilt per rem of parallax travel — ~±2° on a 12rem card. */
const PARALLAX_TILT = 0.3;

/**
 * Mirrors how Figma exports a rotated layer: a bounding box with the
 * un-rotated content centred inside it and rotated about its centre. The box
 * carries its own positioning (`absolute …` or in-flow) so one element can be
 * placed differently per breakpoint.
 */
export const Rotated = ({
  box,
  rotate,
  children,
  as: Tag = "div",
  className,
  parallax,
  parallaxTilt,
}: RotatedProps) => {
  const content = <Tag className={cx("block flex-none", rotate)}>{children}</Tag>;
  if (parallax) {
    return (
      <Parallax
        as={Tag}
        distance={parallax}
        tilt={parallaxTilt ?? parallax * PARALLAX_TILT}
        className={cx(box, className)}
        innerClassName="flex size-full items-center justify-center"
      >
        {content}
      </Parallax>
    );
  }
  return (
    <Tag className={cx("flex items-center justify-center", box, className)}>
      {content}
    </Tag>
  );
};
