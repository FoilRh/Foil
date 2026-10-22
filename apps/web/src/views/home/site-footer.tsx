import { SocialLinks } from "@/components/foil/social-links";
import { MotionSlot } from "@/components/motion/motion-slot";
import { SprayLink } from "@/components/ui/spray-link";

export interface SiteFooterProps {
  brand: string;
  address: string;
  columns: ReadonlyArray<{ title: string; links: readonly string[] }>;
  copyright: string;
  legal: string;
}

const FOOTER_LINKS: Record<string,string> = {Stash:"/dashboard?tab=stash",Tins:"/dashboard?tab=tins",Gifts:"/dashboard?tab=gifts",Overview:"/docs/foil-overview.pdf","Build notes":"/docs/foil-build.pdf",Privacy:"/#record",Collection:"/#vault",FAQs:"/#questions","Local storage":"/privacy-policy"};

const COLUMN_LEFT = ["desktop:left-190", "desktop:left-240", "desktop:left-290"] as const;
const LEGAL = "type-caps text-legal text-foreground-subtle desktop:tracking-caps-wide compact:tracking-caps";

/**
 * Figma "Footer": desktop is the lower part of 5162:14643 (y 854…1286);
 * compact frames 1024 5249:863 · 768 5249:1249 · 390 5249:1603.
 */
export const SiteFooter = ({ brand, address, columns, copyright, legal }: SiteFooterProps) => (
  <footer className="relative mobile:mx-auto mobile:max-w-97.5 desktop:h-108 compact:flex compact:flex-col compact:overflow-clip laptop:gap-12 laptop:px-8 laptop:pb-49.5 tablet:gap-10 tablet:px-10 tablet:pb-37.5 mobile:gap-8 mobile:px-5 mobile:pb-20.75">
    <div className="h-px desktop:absolute desktop:top-0 desktop:left-21 desktop:w-308 desktop:bg-foreground/14 compact:w-full compact:bg-foreground/18" />

    <div className="desktop:contents laptop:flex laptop:items-start laptop:justify-between tablet:flex tablet:items-start tablet:justify-between mobile:contents">
      <div className="flex flex-col desktop:contents laptop:gap-3 tablet:gap-3 mobile:gap-2.5">
        <p className="type-display text-footer-logo text-foreground desktop:absolute desktop:top-7.5 desktop:left-21">
          {brand}
        </p>
        <address className="type-caps text-fine tracking-address text-foreground-subtle not-italic desktop:absolute desktop:top-20.5 desktop:left-21 tablet:w-52.5 tablet:leading-meta tablet:whitespace-normal">
          {address}
        </address>
      </div>

      <div className="flex items-start desktop:contents laptop:gap-18 tablet:gap-12 mobile:gap-7">
        {columns.map((column, i) => (
          <nav
            key={column.title}
            aria-label={column.title}
            className={`flex flex-col desktop:absolute desktop:top-8.5 desktop:block ${COLUMN_LEFT[i]} laptop:gap-3 tablet:gap-3 mobile:gap-2.5`}
          >
            <p className="type-caps text-column tracking-column text-accent">{column.title}</p>
            <ul className="flex flex-col desktop:mt-4 desktop:gap-2.5 laptop:gap-3 tablet:gap-3 mobile:gap-2.5">
              {column.links.map((link) => (
                <li key={link} className="w-fit">
                  <SprayLink
                    href={FOOTER_LINKS[link] ?? "/dashboard"}
                    className="type-caps block text-footer-link tracking-row text-foreground transition-colors duration-[var(--duration-hover)] ease-entrance hover:text-accent"
                    underlineClassName="top-[0.9em] -left-[0.9em] h-[0.8em] w-[calc(100%+1.6em)] text-footer-link"
                  >
                    {link}
                  </SprayLink>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
    </div>

    <div className="desktop:contents laptop:flex laptop:justify-between tablet:flex tablet:justify-between mobile:flex mobile:flex-col mobile:gap-2.5">
      <p className={`${LEGAL} desktop:absolute desktop:top-43.5 desktop:left-21`}>{copyright}</p>
      <p className={`${LEGAL} desktop:absolute desktop:top-43.5 desktop:right-21`}>{legal}</p>
    </div>

    <div className="desktop:absolute desktop:top-29 desktop:left-19"><SocialLinks /></div>

    <MotionSlot
      kind="wordmark"
      as="p"
      aria-hidden
      className="type-display absolute text-wordmark text-transparent opacity-70 [-webkit-text-stroke:1px_var(--foreground)] desktop:top-53 desktop:left-10 laptop:top-64.75 laptop:left-7.5 tablet:top-59 tablet:left-5.5 mobile:top-78 mobile:left-2.75"
    >
      {brand}
    </MotionSlot>
  </footer>
);
