import {PixelIcon} from "@/components/ui/pixel-icon";
import { Eyebrow } from "@/components/ui/eyebrow";
import { GhostWord } from "@/components/ui/ghost-word";
import { Rotated } from "@/components/ui/rotated";
import { Vector } from "@/components/ui/vector";
import { MotionSlot } from "@/components/motion/motion-slot";

export interface QuestionsSectionProps {
  eyebrow: string;
  titleLine1: string;
  titleLine2: string;
  mark: string;
  ghost: string;
  note: string;
  items: ReadonlyArray<{ question: string; answer: string }>;
}

const QUESTION = "type-caps flex-1 text-row-title tracking-row text-foreground compact:leading-row compact:whitespace-normal";
const BRACKET = "type-caps text-bracket text-accent";
const ROW_PAD = "desktop:pt-5.75 desktop:pr-0.5 desktop:pb-7.5 compact:gap-4 compact:py-5.5";

const PlusIcon=({className=""}:{className?:string})=><PixelIcon name="plus" className={`size-5 text-accent ${className}`}/>;
const CloseIcon=({className=""}:{className?:string})=><PixelIcon name="close" className={`size-5 text-accent ${className}`}/>;

/** Figma "Questions": 1400 5203:929 · 1024 5249:785 · 768 5249:1172 · 390 5249:1528. */
export const QuestionsSection = ({
  eyebrow,
  titleLine1,
  titleLine2,
  mark,
  ghost,
  note,
  items,
}: QuestionsSectionProps) => (
  <section id="questions" className="relative overflow-clip desktop:h-204 desktop:bg-background laptop:flex laptop:items-start laptop:gap-12 laptop:px-8 laptop:py-12 handheld:flex handheld:flex-col tablet:gap-10 tablet:p-10 mobile:gap-8 mobile:px-5 mobile:py-8 mobile:mx-auto mobile:max-w-97.5">
    <GhostWord
      word={ghost}
      box="top-74 left-1.75 h-113.25 w-150 compact:hidden"
      rotate="rotate-8"
      size="text-ghost-xl"
    />

    <div className="relative flex flex-col desktop:static desktop:block laptop:w-100 laptop:shrink-0 laptop:gap-6 tablet:w-full tablet:items-center tablet:gap-6 mobile:w-full mobile:gap-5">
      <div className="flex w-full flex-col desktop:contents laptop:items-start laptop:gap-3 tablet:items-center tablet:gap-3 mobile:items-center mobile:gap-2.5">
        <Eyebrow
          label={eyebrow}
          crownBox="desktop:top-37 desktop:left-20 desktop:h-9 desktop:w-10.5"
          labelBox="desktop:top-33 desktop:left-35 desktop:h-11 desktop:w-50.5"
        />
        <h2 className="type-display flex w-full flex-col text-display-sm text-foreground desktop:block handheld:items-center">
          <MotionSlot kind="headline" as="span" index={0} className="block desktop:absolute desktop:top-51.5 desktop:left-21 laptop:-mb-2.75 tablet:-mb-2.5 mobile:-mb-1.75 handheld:text-center">
            {titleLine1}
          </MotionSlot>
          <span className="flex flex-wrap items-center desktop:block laptop:gap-x-3.5 tablet:gap-x-3.25 mobile:gap-x-2.25 handheld:justify-center">
            <MotionSlot kind="headline" as="span" index={1} className="desktop:absolute desktop:top-77.25 desktop:left-21">{titleLine2}</MotionSlot>
            <span className="relative shrink-0 desktop:static laptop:h-20.5 laptop:w-47.25 tablet:h-18.25 tablet:w-42.25 mobile:h-12.25 mobile:w-29">
              <Rotated
                as="span"
                box="absolute desktop:top-71 desktop:left-131.75 desktop:h-35.25 desktop:w-70 laptop:-top-1.5 laptop:left-0.5 laptop:h-23.75 laptop:w-47 tablet:-top-1.5 tablet:left-0.5 tablet:h-21 tablet:w-42 mobile:-top-1 mobile:left-0.5 mobile:h-14.25 mobile:w-28.25"
                rotate="-rotate-4"
              >
                <MotionSlot kind="mark" as="span" className="type-script text-script-xs text-accent normal-case not-italic compact:-translate-y-[0.04em]">{mark}</MotionSlot>
              </Rotated>
              <Rotated
                as="span"
                box="absolute desktop:top-101 desktop:left-133.5 desktop:h-4.5 desktop:w-62.5 laptop:top-16.25 laptop:left-1.5 laptop:h-3.5 laptop:w-42 tablet:top-14.5 tablet:left-1.5 tablet:h-3.25 tablet:w-37.5 mobile:top-9.75 mobile:left-1.5 mobile:h-2.5 mobile:w-25.25"
                rotate="-rotate-3"
              >
                <MotionSlot kind="scribble">
                  <Vector
                    src="/assets/questions/questions-scribble.svg"
                    sources={{
                      laptop: "/assets/questions/questions-scribble-laptop.svg",
                      tablet: "/assets/questions/questions-scribble-tablet.svg",
                      mobile: "/assets/questions/questions-scribble-mobile.svg",
                    }}
                    size="h-1.25 desktop:w-62.5 laptop:w-42 tablet:w-37.5 mobile:w-25.25"
                    inset="desktop:inset-[-74.12%_-1.4%] laptop:inset-[-43.41%_-1.22%] tablet:inset-[-42.35%_-1.33%] mobile:inset-[-42.35%_-1.98%]"
                  />
                </MotionSlot>
              </Rotated>
            </span>
          </span>
        </h2>
      </div>

      <div className="flex items-start gap-2.5 desktop:block laptop:w-100 tablet:w-100 mobile:w-full">
        <span aria-hidden className={`${BRACKET} desktop:absolute desktop:top-127 desktop:left-21`}>
          [
        </span>
        <MotionSlot
          kind="copy"
          as="p"
          className="flex-1 text-body-sm leading-copy text-foreground-muted desktop:absolute desktop:top-128.5 desktop:left-28 desktop:w-75"
        >
          {note}
        </MotionSlot>
        <span
          aria-hidden
          className={`${BRACKET} desktop:absolute desktop:top-132 desktop:left-106 compact:flex compact:w-2.5 compact:self-stretch compact:items-end`}
        >
          ]
        </span>
      </div>
    </div>

    <div className="border-t border-foreground/20 desktop:absolute desktop:top-51.5 desktop:left-212.5 desktop:w-116.5 laptop:flex-1 handheld:w-full">
      {items.map((item, i) => (
        <details key={item.question} name="faq" open={i === 0} className="group border-b border-foreground/20">
          <summary
            className={`flex cursor-pointer list-none items-center justify-between desktop:group-open:pb-4 laptop:group-open:pb-3 tablet:group-open:pb-3 mobile:group-open:pb-2.5 [&::-webkit-details-marker]:hidden ${ROW_PAD}`}
          >
            <span className={QUESTION}>{item.question}</span>
            <PlusIcon className="group-open:hidden" />
            <CloseIcon className="hidden group-open:block" />
          </summary>
          <MotionSlot
            kind="faq"
            as="p"
            className="text-body-sm leading-copy text-foreground-subtle desktop:w-100 desktop:pb-6.5 compact:pb-5.5"
          >
            {item.answer}
          </MotionSlot>
        </details>
      ))}
    </div>
  </section>
);
