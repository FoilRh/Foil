/**
 * The shared shape of a legal page.
 *
 * A Server Component with no motion: these pages are read, not experienced, and
 * every spring here would be hydration cost spent on a document nobody scrolls
 * for pleasure. Plain semantic markup, one `<h1>`, a clean heading outline.
 */
import Link from "next/link";

export interface LegalSection {
  heading: string;
  /** Each entry is a paragraph. */
  body: readonly string[];
}

export interface LegalDocumentProps {
  title: string;
  /** Shown under the title, e.g. "Last updated 10 October 2026". */
  updated: string;
  intro: string;
  sections: readonly LegalSection[];
}

export const LegalDocument = ({
  title,
  updated,
  intro,
  sections,
}: LegalDocumentProps) => (
  <div className="min-h-lvh w-full bg-background px-5 pt-32 pb-24 font-sans text-body leading-copy text-foreground-muted tablet:px-10 laptop:px-12 desktop:px-16 mobile:pt-24">
    <header className="mx-auto w-full max-w-[48rem] pb-8">
      <Link href="/" className="text-accent underline underline-offset-4 transition-opacity duration-[var(--duration-hover)] hover:opacity-70 focus-visible:opacity-70">
        ← FOIL
      </Link>
      {/* type-display is single-line by default; a document title must wrap inside the reading column. */}
      <h1 className="type-display mt-6 text-display-sm leading-display whitespace-normal text-balance text-foreground">{title}</h1>
      <p className="mt-3 opacity-80">{updated}</p>
      <p className="mt-6">{intro}</p>
    </header>

    <main className="mx-auto w-full max-w-[48rem] pb-24">
      {sections.map((section) => (
        <section key={section.heading} className="mt-10">
          <h2 className="type-display text-card-title text-foreground">{section.heading}</h2>
          {section.body.map((paragraph) => (
            <p key={paragraph} className="mt-3">
              {paragraph}
            </p>
          ))}
        </section>
      ))}
    </main>
  </div>
);
