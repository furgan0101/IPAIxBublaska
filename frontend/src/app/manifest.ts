import type { MetadataRoute } from "next";

/** PWA manifest: makes CrisisLens installable as a standalone app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CrisisLens",
    short_name: "CrisisLens",
    description:
      "Crisis signal triage for civil protection teams in Baden-Wuerttemberg.",
    start_url: "/",
    display: "standalone",
    background_color: "#0c0c0d",
    theme_color: "#fdcc00",
  };
}
