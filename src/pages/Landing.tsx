// hi
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingHero } from "@/components/landing/LandingHero";
import { AgentsSection, HowItWorksSection, StartHereSection } from "@/components/landing/LandingSections";
import { LandingFooter } from "@/components/landing/LandingFooter";

/** The public website at "/": what GridNova is, in the order a judge reads it. */
export default function Landing() {
  return (
    <div className="relative flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[70] focus:rounded-md focus:bg-surface-raised focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-fg focus:shadow-lg"
      >
        Skip to content
      </a>
      <LandingHeader />
      <main id="main" className="flex-1">
        <LandingHero />
        <HowItWorksSection />
        <AgentsSection />
        <StartHereSection />
      </main>
      <LandingFooter />
    </div>
  );
}
