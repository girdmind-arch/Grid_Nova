import { Clock3, Cpu, Lock, MapPin, Palette, Smartphone, Target } from "lucide-react";
import { PageHeader, Tabs, TabsContent, TabsList, TabsTrigger, ThemeSwitcher } from "@/components/ui";
import { ControlModeHero } from "@/components/settings/ControlModeHero";
import { GoalPresets } from "@/components/settings/GoalPresets";
import { SimulationClock } from "@/components/settings/SimulationClock";
import { CampusLocationPicker } from "@/components/settings/CampusLocationPicker";
import { HardwareDemo } from "@/components/settings/HardwareDemo";
import { InstallApp } from "@/components/settings/InstallApp";
import { ColourThemePicker } from "@/components/settings/ColourThemePicker";
import { GuardrailRules } from "@/components/agents/GuardrailRules";

const TABS = [
  {
    value: "goal",
    label: "Goal",
    icon: Target,
    description: "What the Orchestrator should aim for.",
    content: <GoalPresets />,
  },
  {
    value: "location",
    label: "Location",
    icon: MapPin,
    description: "Anywhere in India. Sets the live weather and the state's electricity tariff.",
    content: <CampusLocationPicker />,
  },
  {
    value: "clock",
    label: "Clock",
    icon: Clock3,
    description: "Live follows real Indian time and today's weather. Demo evening starts at 17:20 and runs faster.",
    content: <SimulationClock />,
  },
  {
    value: "hardware",
    label: "Hardware",
    icon: Cpu,
    description: "Optional tabletop ESP32 rig. Its real low-voltage readings drive the demo: unplug its adapter and the campus goes into an outage.",
    content: <HardwareDemo />,
  },
  {
    value: "appearance",
    label: "Appearance",
    icon: Palette,
    description: "Pick light or dark (System follows your device), then a colour theme. Both change the whole app and are remembered on this device.",
    content: (
      <div className="space-y-6">
        <section aria-labelledby="mode-label">
          <h3 id="mode-label" className="micro-label mb-2.5 text-fg-subtle">Mode</h3>
          <ThemeSwitcher className="w-full max-w-md" />
        </section>
        <section aria-labelledby="colour-label">
          <h3 id="colour-label" className="micro-label mb-2.5 text-fg-subtle">Colour theme</h3>
          <ColourThemePicker />
        </section>
      </div>
    ),
  },
  {
    value: "app",
    label: "App",
    icon: Smartphone,
    description: "Put GridNova on your home screen. It opens full screen and keeps working without a signal.",
    content: <InstallApp />,
  },
  {
    value: "guardrails",
    label: "Guardrails",
    icon: Lock,
    description: "Hard safety rules. No agent, goal or mode can override them, so they cannot be edited here.",
    content: <GuardrailRules columns={2} />,
  },
];

export default function Settings() {
  // Links such as /app/settings#hardware open that tab.
  const hash = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
  const initial = TABS.some((t) => t.value === hash) ? hash : "goal";
  return (
    <>
      <PageHeader title="Settings" description="Who is in control, what GridNova aims for, and how the app looks." />

      <ControlModeHero />

      <Tabs defaultValue={initial} className="mt-6">
        <TabsList aria-label="Settings">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <TabsTrigger key={t.value} value={t.value}>
                <Icon strokeWidth={1.75} /> {t.label}
              </TabsTrigger>
            );
          })}
        </TabsList>
        {TABS.map((t) => (
          <TabsContent key={t.value} value={t.value} className="glass max-w-4xl rounded-lg border border-glass-border bg-surface p-5 shadow-md sm:p-6">
            <p className="mb-5 text-sm text-fg-muted">{t.description}</p>
            {t.content}
          </TabsContent>
        ))}
      </Tabs>
    </>
  );
}
