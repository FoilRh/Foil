import { cx } from "@/utils/cx";

/** Per-breakpoint art for the same layer — Figma exports one SVG per frame. */
export interface VectorSources {
  laptop?: string;
  tablet?: string;
  mobile?: string;
}

export interface VectorProps {
  /** Desktop art (and the fallback for any breakpoint without its own). */
  src: string;
  sources?: VectorSources;
  /** Size of the layer box (Figma layer width/height), per breakpoint. */
  size: string;
  /** Inset of the art inside the box — Figma bleeds strokes past the layer. */
  inset?: string;
  className?: string;
}

/**
 * A decorative vector layer exported from Figma. Uses <picture> so each
 * breakpoint loads the export drawn for its own frame (stroke widths differ).
 */
export const Vector = ({
  src,
  sources = {},
  size,
  inset = "inset-0",
  className,
}: VectorProps) => (
  <span className={cx("relative block", size, className)} aria-hidden>
    <span className={cx("absolute", inset)}>
      <picture>
        {sources.mobile && <source media="(width < 700px)" srcSet={sources.mobile} />}
        {sources.tablet && <source media="(width < 896px)" srcSet={sources.tablet} />}
        {sources.laptop && <source media="(width < 1200px)" srcSet={sources.laptop} />}
        <img src={src} alt="" className="block size-full" />
      </picture>
    </span>
  </span>
);
