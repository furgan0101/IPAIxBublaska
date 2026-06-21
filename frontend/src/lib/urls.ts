/**
 * Resolve a working external link for a report when the source post/release
 * has no usable URL. Maps sources and titles to their real, official websites
 * (DWD, NINA/warnung.bund.de, Presseportal, local press, social profiles).
 */
export function getWorkingUrl(
  href: string | null | undefined,
  title: string,
  sourceType?: string,
  author?: string
): string {
  if (href && href !== "#" && href.trim() !== "") {
    return href;
  }

  const cleanTitle = title.toLowerCase();
  const src = (sourceType || "").toLowerCase();
  const auth = (author || "").toLowerCase();

  // 1. Weather alerts (DWD, warning apps)
  if (cleanTitle.includes("dwd") || src.includes("dwd")) {
    return "https://www.dwd.de";
  }
  if (cleanTitle.includes("warn-app") || cleanTitle.includes("nina") || src.includes("nina") || src.includes("warn")) {
    return "https://warnung.bund.de";
  }

  // 2. Local News Portals
  if (cleanTitle.includes("südkurier") || cleanTitle.includes("suedkurier")) {
    return "https://www.suedkurier.de";
  }
  if (cleanTitle.includes("swr")) {
    return "https://www.swr.de";
  }
  if (cleanTitle.includes("bnn") || cleanTitle.includes("badische neueste nachrichten")) {
    return "https://bnn.de";
  }
  if (cleanTitle.includes("swp") || cleanTitle.includes("südwest presse")) {
    return "https://www.swp.de";
  }
  if (cleanTitle.includes("presseportal") || src.includes("presseportal")) {
    return "https://www.presseportal.de";
  }

  // 3. Forums & Community Boards
  if (cleanTitle.includes("hn-nachbarn")) {
    return "https://nextdoor.de"; // Local neighborhood forum fallback
  }
  if (cleanTitle.includes("ka-forum")) {
    return "https://www.ka-news.de"; // Karlsruhe forum/news portal
  }
  if (cleanTitle.includes("rhein-neckar") || cleanTitle.includes("hd-talk")) {
    return "https://www.rnz.de"; // Rhein-Neckar/Heidelberg local press
  }

  // 4. Social Media
  if (src.includes("telegram") || auth.includes("telegram") || cleanTitle.includes("t.me")) {
    if (author && author.startsWith("@")) {
      return `https://t.me/s/${author.replace("@", "")}`;
    }
    const tmeMatch = title.match(/t\.me\/([\w_]+)/i);
    if (tmeMatch) {
      return `https://t.me/s/${tmeMatch[1]}`;
    }
    return "https://t.me/s/vost_bw";
  }

  if (src.includes("mastodon") || auth.includes("mastodon")) {
    return "https://mastodon.social";
  }

  if (src.includes("twitter") || src.includes("social") || auth.startsWith("@")) {
    if (author && author.startsWith("@")) {
      return `https://x.com/${author.replace("@", "")}`;
    }
    const twitterMatch = title.match(/@(\w+)/);
    if (twitterMatch) {
      return `https://x.com/${twitterMatch[1]}`;
    }
    return "https://x.com";
  }

  // 5. City Portals (If we can detect the city in the text/title)
  if (cleanTitle.includes("konstanz")) return "https://www.konstanz.de";
  if (cleanTitle.includes("stuttgart")) return "https://www.stuttgart.de";
  if (cleanTitle.includes("karlsruhe")) return "https://www.karlsruhe.de";
  if (cleanTitle.includes("freiburg")) return "https://www.freiburg.de";
  if (cleanTitle.includes("mannheim")) return "https://www.mannheim.de";
  if (cleanTitle.includes("heidelberg")) return "https://www.heidelberg.de";
  if (cleanTitle.includes("heilbronn")) return "https://www.heilbronn.de";
  if (cleanTitle.includes("ulm")) return "https://www.ulm.de";

  // Fallback to warning portal or generic state portal
  return "https://www.baden-wuerttemberg.de";
}
