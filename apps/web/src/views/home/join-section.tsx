import {CardImage} from "@/components/ui/card-image";
import {MotionSlot} from "@/components/motion/motion-slot";
import {SocialLinks} from "@/components/foil/social-links";
import {Rotated} from "@/components/ui/rotated";

export function JoinSection({card}:{card:{src:string;alt:string}}){
  return <section id="join" className="relative mx-auto max-w-screen-2xl px-20 py-24 compact:px-10 mobile:px-5 mobile:py-16">
    <div className="grid grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)] items-center gap-16 mobile:grid-cols-1 mobile:gap-8">
      <div><p className="type-script mb-6 text-3xl text-accent mobile:text-2xl">Stay close to Foil</p><h2 className="type-display whitespace-normal text-7xl leading-display tablet:text-6xl mobile:text-5xl"><MotionSlot kind="headline" as="span">Good company.</MotionSlot><br/><MotionSlot kind="mark" as="span" className="text-accent">Better collecting.</MotionSlot></h2><p className="mt-7 mb-7 max-w-lg text-body leading-copy text-foreground-muted">For updates, questions and conversations with the Foil community, follow us on X and Telegram.</p><SocialLinks channels={["X","Telegram"]} labels/><p className="mt-4 text-xs text-foreground-subtle">Official channel links are coming soon.</p></div>
      <Rotated box="relative mx-auto h-108 w-80 mobile:hidden" rotate="rotate-6" parallax={-5}><CardImage {...card} size="h-full w-full" designWidth={320}/></Rotated>
    </div>
  </section>;
}
