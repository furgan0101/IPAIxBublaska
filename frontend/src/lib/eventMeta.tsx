import {
  Car,
  CloudLightning,
  Flame,
  TriangleAlert,
  Waves,
  Zap,
} from "lucide-react";

import { titleCase } from "@/lib/format";

export interface EventMeta {
  label: string;
  /** Tailwind text color for icons/labels of this event class. */
  color: string;
}

const META: Record<string, EventMeta> = {
  flood: { label: "Flood", color: "text-sky-400" },
  fire: { label: "Fire", color: "text-orange-400" },
  storm: { label: "Storm", color: "text-violet-400" },
  power_outage: { label: "Power outage", color: "text-yellow-300" },
  accident: { label: "Accident", color: "text-teal-300" },
};

export function eventMeta(eventType: string): EventMeta {
  return (
    META[eventType] ?? {
      label: titleCase(eventType.replaceAll("_", " ")),
      color: "text-slate-300",
    }
  );
}

export function EventIcon({
  eventType,
  className,
}: {
  eventType: string;
  className?: string;
}) {
  switch (eventType) {
    case "flood":
      return <Waves className={className} aria-hidden />;
    case "fire":
      return <Flame className={className} aria-hidden />;
    case "storm":
      return <CloudLightning className={className} aria-hidden />;
    case "power_outage":
      return <Zap className={className} aria-hidden />;
    case "accident":
      return <Car className={className} aria-hidden />;
    default:
      return <TriangleAlert className={className} aria-hidden />;
  }
}
