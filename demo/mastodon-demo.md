# CrisisLens Live Demo - Mastodon Injection Playbook

## Setup (do this before the presentation)

1. Each team member creates a free Mastodon account at https://mastodon.social
2. Make sure the backend is running with FEEDS_ENABLED=true
3. Poll interval is set to 30s - posts appear on dashboard within ~30 seconds
4. Open debug.html (or the live dashboard once wired) on the presentation screen

---

## The 3 Demo Posts

Post these from your phone during the presentation. Each triggers a different detection rule.

---

### Post 1 - Bot Spam Detection
**Who posts it:** Team member A (from phone, live on stage)
**Mastodon post text - copy paste exactly:**

```
MEGA-HOCHWASSER in Konstanz!! Die GESAMTE Altstadt steht unter Wasser,
Hunderte eingeschlossen!!! SHARE BEFORE THEY DELETE THIS!
#konstanz #hochwasser #bodensee
```

**What the system catches:** Bot-spam phrase "SHARE BEFORE THEY DELETE THIS"
**Result shown:** Debunked - "Bot-spam phrasing detected"
**Wait time:** ~30 seconds

---

### Post 2 - Credible Incident (for contrast)
**Who posts it:** Team member B (from phone, live on stage)
**Mastodon post text - copy paste exactly:**

```
Feuerwehr gerade an der Konzilstrasse in Konstanz, starke Rauchentwicklung
aus einem Gebaeude in der Naehe des Hafens. Mehrere Fahrzeuge vor Ort.
#konstanz #feuerwehr
```

**What the system does:** Passes credibility filter, appears as verified incident on map
**Result shown:** New incident pin on map, "fire" event type
**Wait time:** ~30 seconds

---

### Post 3 - Amplification / Disinformation
**Who posts it:** Team member A again (second fake post)
**Mastodon post text - copy paste exactly:**

```
GIFTWOLKE ueber Konstanz nach explosion im Industriegebiet!!
The media won't show you this! Teilen bevor es geloescht wird!
Evakuierung laeuft bereits!! #konstanz #unwetter #bodensee
```

**What the system catches:** "The media won't show you this" amplification phrase
**Result shown:** Debunked - "Bot-spam phrasing detected"
**Wait time:** ~30 seconds

---

## Presentation Script

**Presenter says:**
> "Our system ingests live social media. Watch what happens when disinformation enters the pipeline."

*[Team member posts Post 1 from phone]*

> "That post just hit Mastodon with a classic bot-spam phrase. Our heuristic filter catches it..."

*[30 seconds pass, dashboard updates]*

> "...and it goes straight to Disinfo Caught. The map stays clean. No false alarm for responders."

*[Team member posts Post 2]*

> "Now a credible eyewitness report from the same platform..."

*[30 seconds pass]*

> "Verified. New incident on the map. Same pipeline, different outcome based on the content."

---

## Tips

- Practice the timing - 30s feels long on stage, have talking points ready
- Show the source URL in the Disinfo Caught tab - judges can click it and see the real Mastodon post
- If the poll is slow, hit "Poll live feeds" in debug.html to force an immediate fetch
- Use umlaut-free text (ae/oe/ue) in posts to avoid encoding issues on mobile
