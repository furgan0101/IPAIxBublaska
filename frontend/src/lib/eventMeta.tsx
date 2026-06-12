import {
  Activity,
  Atom,
  Biohazard,
  Bomb,
  Car,
  CloudLightning,
  DoorOpen,
  Droplets,
  Flame,
  FlaskConical,
  HeartPulse,
  PhoneOff,
  Radiation,
  ServerCrash,
  ShieldAlert,
  Siren,
  Skull,
  Snowflake,
  SprayCan,
  ThermometerSun,
  Trees,
  TriangleAlert,
  Truck,
  Waves,
  Wheat,
  Wrench,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { titleCase } from "@/lib/format";

export interface EventMeta {
  label: string;
  /** Tailwind text color for icons/labels of this event class. */
  color: string;
}

/**
 * Event taxonomy mirroring the BW Ministry of the Interior crisis catalogue
 * (backend source of truth: backend/logic/guidance.py — keep in sync).
 */
const META: Record<string, EventMeta> = {
  // Natural hazards
  flood: { label: "Flood", color: "text-sky-400" },
  storm: { label: "Storm", color: "text-violet-400" },
  wildfire: { label: "Wildfire", color: "text-amber-500" },
  earthquake: { label: "Earthquake", color: "text-stone-400" },
  heatwave: { label: "Heat wave", color: "text-orange-300" },
  cold_spell: { label: "Cold spell", color: "text-cyan-300" },
  // Technological / industrial
  fire: { label: "Fire", color: "text-orange-400" },
  explosion: { label: "Explosion", color: "text-red-400" },
  chemical_accident: { label: "Chemical accident", color: "text-lime-400" },
  hazmat: { label: "Hazmat release", color: "text-lime-300" },
  accident: { label: "Transport accident", color: "text-teal-400" },
  infrastructure_failure: {
    label: "Infrastructure failure",
    color: "text-slate-300",
  },
  // CBRN
  nuclear_accident: { label: "Nuclear accident", color: "text-yellow-400" },
  radiological: { label: "Radiological", color: "text-yellow-300" },
  biological: { label: "Biological", color: "text-green-400" },
  chemical_attack: { label: "Chemical attack", color: "text-lime-400" },
  // Public health
  pandemic: { label: "Pandemic", color: "text-rose-400" },
  // Terrorism / security
  terror_attack: { label: "Terror attack", color: "text-rose-500" },
  cbrn_attack: { label: "CBRN attack", color: "text-fuchsia-400" },
  hostage: { label: "Hostage situation", color: "text-rose-300" },
  sabotage: { label: "Sabotage", color: "text-zinc-300" },
  // Supply / infrastructure crises
  power_outage: { label: "Power outage", color: "text-yellow-300" },
  telecom_failure: { label: "Telecom failure", color: "text-indigo-300" },
  water_supply: { label: "Water supply", color: "text-sky-300" },
  food_supply: { label: "Food supply", color: "text-amber-300" },
  supply_chain: { label: "Supply chain", color: "text-teal-300" },
  // Civil defence operations
  evacuation: { label: "Evacuation", color: "text-emerald-300" },
};

const ICONS: Record<string, LucideIcon> = {
  flood: Waves,
  storm: CloudLightning,
  wildfire: Trees,
  earthquake: Activity,
  heatwave: ThermometerSun,
  cold_spell: Snowflake,
  fire: Flame,
  explosion: Bomb,
  chemical_accident: FlaskConical,
  hazmat: Skull,
  accident: Car,
  infrastructure_failure: ServerCrash,
  nuclear_accident: Radiation,
  radiological: Radiation,
  biological: Biohazard,
  chemical_attack: SprayCan,
  pandemic: HeartPulse,
  terror_attack: ShieldAlert,
  cbrn_attack: Atom,
  hostage: Siren,
  sabotage: Wrench,
  power_outage: Zap,
  telecom_failure: PhoneOff,
  water_supply: Droplets,
  food_supply: Wheat,
  supply_chain: Truck,
  evacuation: DoorOpen,
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
  const Icon = ICONS[eventType] ?? TriangleAlert;
  return <Icon className={className} aria-hidden />;
}
