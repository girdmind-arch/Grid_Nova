// hi
import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

/** One landing-page band: eyebrow, title, one-line intro, content. Same rhythm for every section. */
export function LandingSection({
  id,
  eyebrow,
  title,
  description,
  children,
  className,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn("mx-auto w-full max-w-[var(--content-max)] scroll-mt-[calc(var(--topbar-h)+16px)] px-[var(--gutter)] py-14 sm:py-20 lg:px-[var(--gutter-lg)]", className)}
    >
      <p className="micro-label text-accent">{eyebrow}</p>
      <h2 id={`${id}-title`} className="mt-2 max-w-2xl text-[26px] leading-tight font-bold tracking-tight text-fg sm:text-[32px]">
        {title}
      </h2>
      {description && <p className="mt-3 max-w-2xl text-base text-fg-muted">{description}</p>}
      <div className="mt-8 sm:mt-10">{children}</div>
    </section>
  );
}
