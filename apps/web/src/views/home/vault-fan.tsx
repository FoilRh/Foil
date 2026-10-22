import { CardImage } from "@/components/ui/card-image";
import { Rotated } from "@/components/ui/rotated";

export interface VaultFanProps {
  /** Figma layer order: far left, far right, left, right, centre. */
  cards: ReadonlyArray<{ src: string; alt: string }>;
}

/**
 * Bounding box, tilt, card size, fill crop and parallax travel (rem) + tilt
 * (deg) for each card of the fan, per breakpoint. The 390 frame drops the two outer cards.
 * The faded outer cards drift down (recede); the centre card rises fastest.
 * Parallax tilts mirror left/right, so the fan opens as the page scrolls.
 */
const FAN = [
  {
    box: "desktop:top-159 desktop:left-25.75 desktop:h-92.25 desktop:w-78.5 laptop:top-16.5 laptop:-left-9.75 laptop:h-85 laptop:w-71.25 tablet:top-16 tablet:-left-25.5 tablet:h-83.25 tablet:w-70 mobile:hidden",
    rotate: "desktop:-rotate-16 compact:-rotate-14",
    card: "opacity-50 desktop:h-79 desktop:w-59 desktop:rounded-art-sm laptop:h-73.75 laptop:w-55 laptop:rounded-xl tablet:h-72.25 tablet:w-54 tablet:rounded-xl",
    crop: undefined,
    parallax: 10,
    tilt: -3,
  },
  {
    box: "desktop:top-159 desktop:left-245.75 desktop:h-92.25 desktop:w-78.5 laptop:top-16.5 laptop:left-174.5 laptop:h-85 laptop:w-71.25 tablet:top-16 tablet:left-127.5 tablet:h-83.25 tablet:w-70 mobile:hidden",
    rotate: "desktop:rotate-16 compact:rotate-14",
    card: "opacity-50 desktop:h-79 desktop:w-59 desktop:rounded-art-sm laptop:h-73.75 laptop:w-55 laptop:rounded-xl tablet:h-72.25 tablet:w-54 tablet:rounded-xl",
    crop: "top-[-0.01%] left-[-0.3%] h-[101.43%] w-[101.66%]",
    parallax: 7,
    tilt: 3,
  },
  {
    box: "desktop:top-142 desktop:left-76.25 desktop:h-99 desktop:w-79.5 laptop:top-8.5 laptop:left-39 laptop:h-80 laptop:w-63.5 tablet:top-8 tablet:left-16 tablet:h-78.25 tablet:w-62.5 mobile:top-7 mobile:-left-0.75 mobile:h-47 mobile:w-37.75",
    rotate: "desktop:-rotate-8 laptop:-rotate-7 tablet:-rotate-7 mobile:-rotate-8",
    card: "desktop:h-90.5 desktop:w-67.5 desktop:rounded-art-md desktop:opacity-82 laptop:h-73.75 laptop:w-55 laptop:rounded-xl laptop:opacity-82 tablet:h-72.25 tablet:w-54 tablet:rounded-xl tablet:opacity-82 mobile:h-43 mobile:w-32 mobile:rounded-art-xs mobile:opacity-75",
    crop: "top-0 left-[-0.17%] h-[100.75%] w-[101.21%]",
    parallax: -4,
    tilt: -2.5,
  },
  {
    box: "desktop:top-142 desktop:left-194.25 desktop:h-99 desktop:w-79.5 laptop:top-8.5 laptop:left-133.5 laptop:h-80 laptop:w-63.5 tablet:top-8 tablet:left-93.5 tablet:h-78.25 tablet:w-62.5 mobile:top-7 mobile:left-50.75 mobile:h-47 mobile:w-37.75",
    rotate: "desktop:rotate-8 laptop:rotate-7 tablet:rotate-7 mobile:rotate-8",
    card: "desktop:h-90.5 desktop:w-67.5 desktop:rounded-art-md desktop:opacity-82 laptop:h-73.75 laptop:w-55 laptop:rounded-xl laptop:opacity-82 tablet:h-72.25 tablet:w-54 tablet:rounded-xl tablet:opacity-82 mobile:h-43 mobile:w-32 mobile:rounded-art-xs mobile:opacity-75",
    crop: "top-[0.12%] left-[5.15%] h-[99.95%] w-[89.71%]",
    parallax: -7,
    tilt: 2.5,
  },
  {
    box: "desktop:top-134.25 desktop:left-135.5 desktop:h-104.5 desktop:w-79.25 laptop:top-3.75 laptop:left-89.5 laptop:h-75.25 laptop:w-57 tablet:top-2.75 tablet:left-58 tablet:h-73.75 tablet:w-56 mobile:top-1.5 mobile:left-27.25 mobile:h-43.75 mobile:w-33",
    rotate: "rotate-[1.5deg]",
    card: "desktop:h-102.5 desktop:w-76.5 desktop:rounded-art-lg laptop:h-73.75 laptop:w-55 laptop:rounded-xl tablet:h-72.25 tablet:w-54 tablet:rounded-xl mobile:h-43 mobile:w-32 mobile:rounded-art-xs",
    crop: undefined,
    parallax: -12,
    tilt: 1,
  },
] as const;

/** The card fan in Figma "Vault" — desktop positions are section-relative. */
export const VaultFan = ({ cards }: VaultFanProps) => (
  <div className="relative w-full desktop:static laptop:h-96.25 tablet:h-96.25 mobile:h-57">
    {FAN.map((layout, i) => (
      <Rotated key={layout.box} box={`absolute ${layout.box}`} rotate={layout.rotate} parallax={layout.parallax} parallaxTilt={layout.tilt}>
        <CardImage
          src={cards[i].src}
          alt={cards[i].alt}
          size={layout.card}
          designWidth={306}
          index={i}
          crop={layout.crop}
        />
      </Rotated>
    ))}
  </div>
);
