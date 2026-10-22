import { Rotated } from "@/components/ui/rotated";
import { Vector } from "@/components/ui/vector";
import type { Stat } from "@/data/mocks/home";
import { MotionSlot } from "@/components/motion/motion-slot";

export interface ProcessStepProps {
  number: string;
  title: string;
  text: string;
  stats: readonly Stat[];
  /** Figma alternates the desktop crown tilt between odd and even steps. */
  variant: "a" | "b";
  /** Position in the row — staggers the reveal. */
  index?: number;
}

const CROWN = {
  a: {
    box: "desktop:top-7 desktop:left-56.25",
    rotate: "desktop:rotate-10",
    src: "/assets/process/process-crown-a.svg",
  },
  b: {
    box: "desktop:top-5.25 desktop:left-57.5",
    rotate: "desktop:-rotate-10",
    src: "/assets/process/process-crown-b.svg",
  },
} as const;

/**
 * Figma "Step 0X". Desktop: 296×400 card with absolute layers, rotated by the
 * parent. Compact: auto-height column (472 / 336 / 350 wide).
 */
export const ProcessStep = ({ number, title, text, stats, variant, index = 0 }: ProcessStepProps) => {
  const crown = CROWN[variant];
  return (
    <MotionSlot
      kind="step"
      as="article"
      index={index}
      className="relative overflow-clip rounded-xl border-2 border-border-strong bg-surface desktop:h-100 desktop:w-74 compact:flex compact:flex-col compact:p-6 laptop:w-118 laptop:gap-3 tablet:w-84 tablet:gap-3 mobile:w-87.5 mobile:gap-2.5">
      <div className="flex items-start justify-between desktop:block">
        <p aria-hidden className="type-display text-step-number text-accent desktop:absolute desktop:top-0.5 desktop:left-4.5">
          {number}
        </p>
        <Rotated
          box={`desktop:absolute desktop:h-9.25 desktop:w-10.75 ${crown.box}`}
          rotate={crown.rotate}
        >
          <Vector
            src={crown.src}
            sources={{ laptop: "/assets/process/process-crown-compact.svg" }}
            size="desktop:h-7.75 desktop:w-9.5 compact:h-[1.73125rem] compact:w-[2.15625rem]"
            inset="inset-[-4.05%_-3.26%]"
          />
        </Rotated>
      </div>
      <h3 className="type-display text-card-title text-foreground desktop:absolute desktop:top-35 desktop:left-5.5">
        {title}
      </h3>
      <p className="text-body-sm leading-copy text-foreground-subtle desktop:absolute desktop:top-49.5 desktop:left-5.5 desktop:w-62">
        {text}
      </p>
      <p className="type-caps rounded-lg border border-foreground/22 bg-foreground/3 text-meta tracking-nav whitespace-pre text-foreground desktop:absolute desktop:top-81 desktop:left-3.5 desktop:h-13.5 desktop:w-66 desktop:pt-3.75 desktop:pl-3.75 compact:px-3.5 compact:py-3 compact:whitespace-pre-wrap">
        {stats.map((stat, i) => (
          <span key={stat.label}>
            {i > 0 && "   "}
            {`${stat.label} `}
            <span className="text-accent">{stat.value}</span>
          </span>
        ))}
      </p>
    </MotionSlot>
  );
};
