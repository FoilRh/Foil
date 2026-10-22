import { Rotated } from "@/components/ui/rotated";
import { cx } from "@/utils/cx";

export interface GhostWordProps {
  word: string;
  /** Bounding box per breakpoint (absolute). Hidden where not given. */
  box: string;
  rotate: string;
  /** Text size utility, e.g. `text-ghost-sm`. */
  size: string;
}

/** Huge 5%-opacity script word sitting behind a section heading. */
export const GhostWord = ({ word, box, rotate, size }: GhostWordProps) => (
  <Rotated box={cx("pointer-events-none absolute", box)} rotate={rotate}>
    <span aria-hidden className={cx("type-script text-foreground/5", size)}>
      {word}
    </span>
  </Rotated>
);
