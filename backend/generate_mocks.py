#!/usr/bin/env python3
"""Generate a large synthetic OSINT feed for the VOSTbw dashboard demo.

Produces 60 reports (25 credible, 35 debunked) spread across 4 Baden-Württemberg
cities, 10+ event types, multi-source clusters and all 3 heuristic debunk rules
(bot-spam phrasing, stale EXIF, geotag drift). Outputs `mock_data.json` in the
same directory, structured to match `RawReport` in `schemas.py`.

Usage:
    python generate_mocks.py          # writes/overwrites mock_data.json
    python generate_mocks.py --dry-run  # print summary, don't write
"""
from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

# ── Konstanz anchor points (real places, fictional coordinates +- jitter) ──────
KN = {
    "hafen": (47.6597, 9.1780),
    "altstadt": (47.6622, 9.1745),
    "stadtgarten": (47.6622, 9.1795),
    "niederburg": (47.6663, 9.1748),
    "herosee": (47.6648, 9.1692),
    "schaenzle": (47.6652, 9.1681),
    "petershausen": (47.6688, 9.1815),
    "litzelstetten": (47.6985, 9.1920),
    "staad": (47.6745, 9.2008),
    "bahnhof": (47.6594, 9.1763),
    "seestrasse": (47.6641, 9.1809),
    "rheinsteig": (47.6655, 9.1739),
}

# Stuttgart
STG = {
    "mitte": (48.7784, 9.1800),
    "west": (48.7715, 9.1697),
    "bad_cannstatt": (48.8012, 9.2215),
    "feuerbach": (48.8120, 9.1750),
    "hauptbahnhof": (48.7838, 9.1819),
}

# Freiburg
FR = {
    "altstadt": (47.9968, 7.8497),
    "dreisam": (47.9945, 7.8521),
    "stuehlinger": (47.9991, 7.8422),
    "hauptbahnhof": (47.9978, 7.8428),
}

# Karlsruhe
KA = {
    "oststadt": (49.0092, 8.4039),
    "durlach": (49.0081, 8.4012),
    "innenstadt": (49.0089, 8.3966),
    "weststadt": (49.0094, 8.3851),
}

CITIES: dict[str, dict[str, tuple[float, float]]] = {
    "KN": KN, "STG": STG, "FR": FR, "KA": KA,
}

# Real nearby cities for geotag-drift fakes (GPS far from claimed location).
DRIFT_GPS: dict[str, tuple[float, float]] = {
    "stuttgart":  (48.7758, 9.1829),   # ~120 km from Konstanz
    "muenchen":   (48.1374, 11.5755),  # ~200 km from Stuttgart
    "basel":      (47.5596, 7.5886),   # ~55 km from Freiburg
    "mannheim":   (49.4875, 8.4660),   # ~55 km from Karlsruhe
    "zuerich":    (47.3769, 8.5417),   # ~70 km from Konstanz
    "ulm":        (48.4011, 9.9876),   # ~80 km from Stuttgart
    "strasbourg": (48.5839, 7.7455),   # ~65 km from Freiburg
    "heidelberg": (49.4094, 8.6947),   # ~50 km from Karlsruhe
    "friedrichshafen": (47.6500, 9.4833),  # ~25 km from Konstanz (borderline >5 km)
    "tuebingen":  (48.5216, 9.0556),   # ~35 km from Stuttgart
    "colmar":     (48.0794, 7.3584),   # ~45 km from Freiburg
}

# ── Bot-spam phrasing snippets (mixed in with otherwise normal-looking text) ───
BOT_MARKERS: list[str] = [
    "BREAKING!!! {claim} SHARE BEFORE THEY DELETE THIS!",
    "{claim} The media won't show you this! Wake up people!",
    "100% CONFIRMED!!! {claim} t.me/breaking",
    "WAKE UP PEOPLE!!! {claim} They're hiding the truth!!",
    "CLICK HERE for the REAL footage! {claim} #wakeup",
    "{claim} SHARE BEFORE THEY DELETE THIS! t.me/panik_news",
    "{claim} The media won't show you the real damage!! 100% confirmed!!!",
    "They're LYING about {claim}!! Wake up people!! Spread the truth!",
    "BREAKING!!! {claim} CLICK HERE for uncensored footage!",
    "{claim} THE GOVERNMENT DOESN'T WANT YOU TO KNOW!! Share before they delete this!",
    "100% CONFIRMED!!! {claim} #spaß #wakeup",
    "The media won't show you: {claim} SHARE NOW before they censor it!!",
]

# ── Generator config ───────────────────────────────────────────────────────────

@dataclass
class ReportSpec:
    """Blueprint for one report. Fields left as None are filled by the generator."""
    id: str
    source: Literal["twitter", "telegram", "mastodon"]
    author: str
    text: str
    event_type: str
    lat: float
    lon: float
    timestamp_offset: int  # minutes before BASE_TIME
    # Debunk triggers (None = credible report)
    stale_hours: int | None = None        # exif_timestamp = post_time - this
    drift_gps: str | None = None          # key into DRIFT_GPS
    bot_marker: bool = False               # wraps text in bot phrasing
    media_url: str | None = None

    def to_dict(self, base_time: datetime) -> dict:
        ts = base_time - timedelta(minutes=self.timestamp_offset)
        report: dict = {
            "id": self.id,
            "source": self.source,
            "author": self.author,
            "text": self.text,
            "event_type": self.event_type,
            "lat": round(self.lat, 6),
            "lon": round(self.lon, 6),
            "timestamp": ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "exif_timestamp": None,
            "exif_lat": None,
            "exif_lon": None,
            "media_url": self.media_url,
        }
        if self.stale_hours is not None:
            report["exif_timestamp"] = (
                ts - timedelta(hours=self.stale_hours)
            ).strftime("%Y-%m-%dT%H:%M:%SZ")
        if self.drift_gps is not None:
            gps = DRIFT_GPS[self.drift_gps]
            report["exif_lat"] = round(gps[0], 6)
            report["exif_lon"] = round(gps[1], 6)
        return report


# ── Credible clusters (25 reports) ─────────────────────────────────────────────

def _jitter(lat: float, lon: float, noise: float = 0.0006) -> tuple[float, float]:
    """Add tiny random wobble so GPS coordinates look realistic within a cluster."""
    import random
    random.seed(hash(f"{lat}{lon}"))
    return (
        round(lat + random.uniform(-noise, noise), 6),
        round(lon + random.uniform(-noise, noise), 6),
    )


def credible_reports() -> list[ReportSpec]:
    """25 credible reports: 5 multi-source clusters + 6 singletons."""
    r: list[ReportSpec] = []

    # ── Cluster A: Konstanz flood (5 reports, Hafen / Altstadt / Stadtgarten) ──
    flood_texts = [
        ("@bodensee_spotter", "twitter",
         "Wasser läuft über die Hafenpromenade beim Konzil — Pegel steigt schnell, mehrere Keller laufen voll. #Konstanz #Hochwasser",
         "https://media.example.com/vost/flood_hafen.jpg"),
        ("kn_warnkanal", "telegram",
         "Stadtgarten Konstanz: Uferweg komplett überflutet, Feuerwehr pumpt bereits. Foto von eben.",
         "https://media.example.com/vost/stadtgarten_ufer.jpg"),
        ("@seeblick_kn", "mastodon",
         "Seestraße zwischen Yachthafen und Casino unter Wasser, Autos drehen um. Bitte den Bereich meiden! #Bodensee #Hochwasser",
         None),
        ("@hafen_kn", "twitter",
         "Wasser steht jetzt auch in der Tiefgarage am Hafen Konstanz, Stadtwerke vor Ort. #Hochwasser",
         None),
        ("@kn_polizei", "twitter",
         "Polizei sperrt Hafenstraße zwischen Konzil und Hafenbahnhof wegen Überflutung. Bitte umfahren. #Konstanz",
         None),
    ]
    for i, (author, source, text, media) in enumerate(flood_texts):
        lat, lon = _jitter(*KN["hafen"])
        r.append(ReportSpec(
            id=f"RPT-{1 + i:03d}",
            source=source, author=author, text=text,
            event_type="flood", lat=lat, lon=lon,
            timestamp_offset=5 + i * 6, media_url=media,
        ))

    # ── Cluster B: Konstanz fire (4 reports, Niederburg / Rheingasse) ──
    fire_texts = [
        ("@kn_alerts", "twitter",
         "Rauchsäule über der Niederburg, brennt ein Dachstuhl in der Rheingasse? Feuerwehr ist vor Ort. #Konstanz"),
        ("konstanz_live", "telegram",
         "Update Rheingasse: Dachstuhl brennt, Drehleiter im Einsatz, Rheinsteig ist gesperrt."),
        ("@feuerwehr_kn", "twitter",
         "Einsatzmeldung: Dachstuhlbrand Rheingasse, dichte Rauchentwicklung. Anwohner Fenster geschlossen halten."),
        ("@kn_nachbar", "mastodon",
         "Brandgeruch bis runter zum Hafen zu riechen, Feuerwehr ist mit mehreren Wagen da. Hoffentlich niemand verletzt."),
    ]
    for i, (author, source, text) in enumerate(fire_texts):
        lat, lon = _jitter(*KN["niederburg"])
        r.append(ReportSpec(
            id=f"RPT-{6 + i:03d}",
            source=source, author=author, text=text,
            event_type="fire", lat=lat, lon=lon,
            timestamp_offset=8 + i * 7, media_url=(
                "https://media.example.com/vost/rauch_rheingasse.jpg" if i == 0 else None
            ),
        ))

    # ── Cluster C: Konstanz storm (3 reports, Herosé-Park / Schänzlebrücke) ──
    storm_texts_kn = [
        ("kn_unwetter", "telegram",
         "Sturmböe hat mehrere Bäume im Herosé-Park umgeworfen, Uferweg am Seerhein blockiert. Bitte umfahren."),
        ("@rad_kn", "twitter",
         "Baum auf den Fahrradweg an der Schänzlebrücke gestürzt, Sperrung in beide Richtungen. Vorsicht bei Böen!"),
        ("@stadt_kn", "twitter",
         "Stadt Konstanz meldet: Umgestürzte Bäume im Herosé-Park und entlang des Seerhein-Uferwegs. Bauhof rückt aus."),
    ]
    for i, (author, source, text) in enumerate(storm_texts_kn):
        lat, lon = _jitter(*KN["herosee"])
        r.append(ReportSpec(
            id=f"RPT-{10 + i:03d}",
            source=source, author=author, text=text,
            event_type="storm", lat=lat, lon=lon,
            timestamp_offset=10 + i * 8,
        ))

    # ── Cluster D: Stuttgart chemical accident (3 reports, Bad Cannstatt) ──
    chem_texts = [
        ("@stuttgart_pol", "twitter",
         "Gefahrgutaustritt in einem Industriebetrieb Bad Cannstatt, Anwohner im Umkreis von 300 m gebeten Fenster zu schließen."),
        ("stg_warnkanal", "telegram",
         "Beißen der Geruch im Bereich Neckarvorstadt, Atemwegsreizungen gemeldet. Feuerwehr mit ABC-Zug vor Ort."),
        ("@feuerwehr_stg", "twitter",
         "ABC-Einsatz Bad Cannstatt: Austritt aus einem Lagertank, Messfahrzeuge kontrollieren Luft. Keine Evakuierung nötig."),
    ]
    for i, (author, source, text) in enumerate(chem_texts):
        lat, lon = _jitter(*STG["bad_cannstatt"])
        r.append(ReportSpec(
            id=f"RPT-{13 + i:03d}",
            source=source, author=author, text=text,
            event_type="chemical_accident", lat=lat, lon=lon,
            timestamp_offset=12 + i * 9,
        ))

    # ── Cluster E: Freiburg storm (3 reports, Dreisam river area) ──
    fr_storm_texts = [
        ("@freiburg_unwetter", "twitter",
         "Orkanböen im Dreisamtal, mehrere Bäume auf die B31 gestürzt Richtung Kirchzarten. Straße komplett dicht."),
        ("fr_notruf", "telegram",
         "B31 zwischen Freiburg und Kirchzarten gesperrt wegen umgestürzter Bäume. Rettungskräfte im Einsatz."),
        ("@swr_fr", "twitter",
         "SWR Verkehr: B31 voll gesperrt nach Sturmschäden, Umleitung über L133 empfohlen. Böen halten an."),
    ]
    for i, (author, source, text) in enumerate(fr_storm_texts):
        lat, lon = _jitter(*FR["dreisam"])
        r.append(ReportSpec(
            id=f"RPT-{16 + i:03d}",
            source=source, author=author, text=text,
            event_type="storm", lat=lat, lon=lon,
            timestamp_offset=15 + i * 10,
        ))

    # ── Cluster F: Karlsruhe power_outage (2 reports, Oststadt) ──
    r.append(ReportSpec(
        id="RPT-019", source="twitter", author="@karlsruhe_stadt",
        text="Stromausfall in Teilen der Oststadt, Ampeln an der Durlacher Allee dunkel. Stadtwerke informiert.",
        event_type="power_outage", lat=49.0092, lon=8.4039, timestamp_offset=20,
    ))
    r.append(ReportSpec(
        id="RPT-020", source="telegram", author="ka_stadtwerke",
        text="Trafo-Störung in Karlsruhe-Oststadt, mehrere Blocks betroffen. Techniker unterwegs, ETA 45 min.",
        event_type="power_outage", lat=49.0088, lon=8.4042, timestamp_offset=26,
    ))

    # ── Singletons (6 credible, one report each — become their own incident) ───
    singletons = [
        ("RPT-021", "twitter", "@konstanz_dwd", "heatwave",
         47.6711, 9.1833,
         "Hitzewarnung Stufe 2 für den Bodenseekreis: Temperaturen bis 39 °C, UV-Index 9. Kühlräume in Konstanz geöffnet."),
        ("RPT-022", "twitter", "@stuttgart_warn", "explosion",
         48.7715, 9.1697,
         "Gasexplosion in einem Wohnhaus in Stuttgart-West, Feuerwehr und Rettungsdienst vor Ort. Mehrere Verletzte gemeldet."),
        ("RPT-023", "twitter", "@fr_gesundheit", "pandemic",
         47.9968, 7.8497,
         "Norovirus-Ausbruch im Uniklinikum Freiburg: Zwei Stationen unter Quarantäne, Besucherstopp verhängt."),
        ("RPT-024", "twitter", "@ka_presse", "evacuation",
         49.0081, 8.4012,
         "Bombenfund bei Bauarbeiten in Karlsruhe-Durlach, 500-kg-WWII-Sprengkörper. Evakuierung im 800-m-Radius läuft."),
        ("RPT-025", "telegram", "kn_stadtwerke", "water_supply",
         47.6689, 9.1821,
         "Rohrbruch Hauptwasserleitung Petershausen, Trinkwasserversorgung teilweise unterbrochen. Notversorgung wird eingerichtet."),
    ]
    for rid, source, author, etype, lat, lon, text in singletons:
        r.append(ReportSpec(
            id=rid, source=source, author=author, text=text,
            event_type=etype, lat=lat, lon=lon,
            timestamp_offset=30 + (int(rid[4:]) - 20) * 5,
        ))

    return r


# ── Debunked reports (35 reports) ──────────────────────────────────────────────

def debunked_reports() -> list[ReportSpec]:
    """35 deliberately flagged reports: 12 bot-spam, 12 stale EXIF, 11 geotag drift."""
    r: list[ReportSpec] = []

    # ── Bot-spam (12 reports): credible-looking claims wrapped in amplification ──
    bot_claims: list[tuple[str, tuple[float, float], str, str, str]] = [
        # (event_type, (lat,lon), author, source, short_claim_text)
        ("flood", KN["altstadt"], "@panik_news_de", "telegram",
         "Staudamm bei Konstanz GEBROCHEN, Altstadt wird evakuiert!"),
        ("flood", KN["hafen"], "@wahrheit_jetzt", "twitter",
         "der Bodensee-Hafen steht komplett unter Wasser, Hunderte eingeschlossen!"),
        ("chemical_accident", STG["bad_cannstatt"], "@stg_breaking", "telegram",
         "Giftgas-Austritt in Stuttgart-Bad Cannstatt, ganze Stadtteile geräumt!"),
        ("fire", FR["altstadt"], "@fr_alarm", "twitter",
         "das Freiburger Münster brennt und niemand berichtet darüber!"),
        ("storm", KA["innenstadt"], "@ka_panik", "mastodon",
         "Tornado verwüstet Karlsruhe-Innenstadt, Dächer abgedeckt!"),
        ("explosion", STG["hauptbahnhof"], "@blitz_news_24", "telegram",
         "RIESEN-EXPLOSION am Stuttgarter Hauptbahnhof, Bahnhof evakuiert!"),
        ("terror_attack", FR["hauptbahnhof"], "@fr_truth", "twitter",
         "Terroranschlag am Freiburger Hauptbahnhof, mehrere Tote!"),
        ("nuclear_accident", KA["weststadt"], "@ka_truth", "telegram",
         "den Strahlenunfall am KIT Karlsruhe, angeblich 'geringfügig'!"),
        ("pandemic", STG["mitte"], "@stg_gesundheit", "twitter",
         "die echten Pandemie-Zahlen in Stuttgart, 1000+ neue Fälle!"),
        ("hostage", KN["altstadt"], "@kn_police_scan", "mastodon",
         "Geiselnahme in der Konstanzer Altstadt, Polizei riegelt ab!"),
        ("hazmat", STG["feuerbach"], "@stg_hazmat", "telegram",
         "Gefahrgut-LKW auf der A81 gekippt, tödliche Chemikalien ausgelaufen!"),
        ("sabotage", KA["oststadt"], "@ka_hack", "twitter",
         "Cyber-Angriff auf das Stromnetz Karlsruhe, Blackout steht bevor!"),
    ]
    for i, (etype, (lat, lon), author, source, claim) in enumerate(bot_claims):
        marker = BOT_MARKERS[i % len(BOT_MARKERS)]
        text = marker.format(claim=claim)
        r.append(ReportSpec(
            id=f"RPT-{26 + i:03d}", source=source, author=author, text=text,
            event_type=etype, lat=lat, lon=lon,
            timestamp_offset=35 + i * 3, bot_marker=True,
        ))

    # ── Stale EXIF (12 reports): media captured >48 h before posting ──
    stale_specs: list[tuple[str, tuple[float, float], str, str, str, int, str | None]] = [
        # (event_type, (lat,lon), author, source, text, stale_hours, media_url)
        ("flood", KN["hafen"], "@altvideo_kanal", "telegram",
         "AKTUELLE Aufnahmen vom Hochwasser in Konstanz, gerade reingekommen!",
         72, "https://video.example.net/flut_archiv_2019.mp4"),
        ("flood", KN["altstadt"], "@kn_flood_2024", "twitter",
         "Konstanz Altstadt überschwemmt, das Wasser steigt weiter! Eigenes Video!",
         17520, "https://media.example.com/vost/flood_2024_archive.jpg"),  # 2 years
        ("fire", KN["niederburg"], "@feuer_foto_kn", "twitter",
         "Brand in der Niederburg, Flammen schlagen aus dem Dach! Gerade fotografiert.",
         96, "https://media.example.com/vost/fire_last_week.jpg"),
        ("fire", STG["feuerbach"], "@stg_feuer", "telegram",
         "Fabrikbrand in Stuttgart-Feuerbach, Rauchsäule kilometerweit sichtbar! Live-Bild!",
         120, "https://media.example.com/vost/stg_fire_old.jpg"),
        ("storm", FR["dreisam"], "@fr_sturm_archiv", "mastodon",
         "Sturmschäden im Dreisamtal: B31 komplett blockiert, umgestürzte Bäume! Aktuell!",
         8760, "https://media.example.com/vost/storm_2025.jpg"),  # 1 year
        ("chemical_accident", STG["bad_cannstatt"], "@stg_chem", "telegram",
         "Chemieunfall Bad Cannstatt — beißende Dämpfe, Feuerwehr evakuiert! Foto vor Ort.",
         168, "https://media.example.com/vost/chem_week_old.jpg"),
        ("explosion", KA["oststadt"], "@ka_boom", "twitter",
         "Gas-Explosion in der Karlsruher Oststadt! Mehrere Häuser betroffen! Gerade passiert!",
         2160, "https://media.example.com/vost/explosion_3mo.jpg"),  # 3 months
        ("wildfire", FR["dreisam"], "@schwarzwald_brennt", "twitter",
         "Waldbrand am Schönberg bei Freiburg, Flammen nähern sich Wohngebiet! Eigenes Foto!",
         4380, "https://media.example.com/vost/wildfire_6mo.jpg"),  # 6 months
        ("terror_attack", STG["hauptbahnhof"], "@stg_terror", "telegram",
         "Anschlag am Stuttgarter Hbf — bewaffnete Angreifer, viele Verletzte! Bild von jetzt!",
         8760, "https://media.example.com/vost/terror_2025.jpg"),
        ("hazmat", KA["weststadt"], "@ka_hazmat", "mastodon",
         "Gefahrgut-LKW umgekippt auf der Südtangente Karlsruhe! Autobahn gesperrt!",
         96, "https://media.example.com/vost/hazmat_old.jpg"),
        ("evacuation", FR["stuehlinger"], "@fr_bombe", "twitter",
         "Bombenevakuierung in Freiburg-Stühlinger, 5000 Menschen betroffen! Live-Foto!",
         336, "https://media.example.com/vost/evac_2weeks.jpg"),
        ("pandemic", STG["mitte"], "@stg_virus", "telegram",
         "Mysteriöse Krankheit in Stuttgart, Kliniken überfüllt! Aktuelles Bild aus der Notaufnahme!",
         13140, "https://media.example.com/vost/hospital_2024.jpg"),  # 1.5 years
    ]
    for i, (etype, (lat, lon), author, source, text, stale_h, media) in enumerate(stale_specs):
        r.append(ReportSpec(
            id=f"RPT-{38 + i:03d}", source=source, author=author, text=text,
            event_type=etype, lat=lat, lon=lon,
            timestamp_offset=40 + i * 4, stale_hours=stale_h, media_url=media,
        ))

    # ── Geotag drift (11 reports): EXIF GPS >5 km from claimed location ───
    drift_specs: list[tuple[str, tuple[float, float], str, str, str, str, str]] = [
        # (event_type, (claimed_lat,lon), author, source, text, drift_key, media_url)
        ("flood", KN["hafen"], "@photo_truth_kn", "twitter",
         "Massive Überflutung direkt am Konstanzer Hafen, eigenes Foto von vor 5 Minuten!",
         "stuttgart",
         "https://media.example.com/vost/flood_kn_but_stg.jpg"),
        ("fire", STG["mitte"], "@stg_reporter", "twitter",
         "Großbrand in Stuttgart-Mitte, Rauchwolke über dem Rathaus! Gerade aufgenommen!",
         "muenchen",
         "https://media.example.com/vost/fire_stg_but_muc.jpg"),
        ("storm", FR["altstadt"], "@fr_foto", "mastodon",
         "Sturmschäden mitten in der Freiburger Innenstadt, Dachziegel fliegen! Eigenes Bild!",
         "basel",
         "https://media.example.com/vost/storm_fr_but_bsl.jpg"),
        ("chemical_accident", KA["innenstadt"], "@ka_presse_fake", "twitter",
         "Chemieunfall im Zentrum von Karlsruhe, Anwohner klagen über Atemnot! Vor-Ort-Foto!",
         "mannheim",
         "https://media.example.com/vost/chem_ka_but_ma.jpg"),
        ("fire", KN["niederburg"], "@kn_flames", "telegram",
         "Dachstuhlbrand in der Niederburg, Flammen greifen auf Nachbarhaus über! Bild von jetzt!",
         "zuerich",
         "https://media.example.com/vost/fire_kn_but_zh.jpg"),
        ("explosion", STG["west"], "@stg_west", "twitter",
         "Gasexplosion in Stuttgart-West, Trümmer auf der Straße! Gerade fotografiert!",
         "ulm",
         "https://media.example.com/vost/explosion_stg_but_ulm.jpg"),
        ("flood", FR["dreisam"], "@fr_dreisam", "telegram",
         "Dreisam über die Ufer getreten, Straßen in Freiburg-Ost überflutet! Live-Bild!",
         "strasbourg",
         "https://media.example.com/vost/flood_fr_but_str.jpg"),
        ("storm", KA["durlach"], "@ka_wetter", "mastodon",
         "Tornado-Schäden in Karlsruhe-Durlach, Autos umgeworfen! Aktuelles Foto!",
         "heidelberg",
         "https://media.example.com/vost/storm_ka_but_hd.jpg"),
        ("chemical_accident", KN["staad"], "@hafen_meldung_fake", "twitter",
         "Gefahrgutaustritt am Fährhafen Staad, beißender Geruch, Feuerwehr riegelt ab! Bild!",
         "friedrichshafen",
         "https://media.example.com/vost/chem_kn_but_fn.jpg"),
        ("hazmat", STG["feuerbach"], "@stg_unfall", "telegram",
         "Gefahrgut-Unfall auf der B295 bei Stuttgart-Feuerbach, Straße gesperrt! Vor-Ort-Foto!",
         "tuebingen",
         "https://media.example.com/vost/hazmat_stg_but_tue.jpg"),
        ("evacuation", FR["stuehlinger"], "@fr_evac", "twitter",
         "Evakuierung in Freiburg-Stühlinger, Bombenfund! Alle müssen raus! Eigenes Bild!",
         "colmar",
         "https://media.example.com/vost/evac_fr_but_col.jpg"),
    ]
    for i, (etype, (lat, lon), author, source, text, drift_key, media) in enumerate(drift_specs):
        r.append(ReportSpec(
            id=f"RPT-{50 + i:03d}", source=source, author=author, text=text,
            event_type=etype, lat=lat, lon=lon,
            timestamp_offset=45 + i * 5, drift_gps=drift_key, media_url=media,
        ))

    return r


# ── Main ───────────────────────────────────────────────────────────────────────

def generate() -> list[dict]:
    """Assemble all 60 reports and return them as a list of dicts."""
    # Base time: noon 2026-06-12 UTC (backend rebases to 'now' at startup anyway)
    base = datetime(2026, 6, 12, 12, 30, 0, tzinfo=timezone.utc)

    credible = credible_reports()
    debunked = debunked_reports()

    all_reports = [spec.to_dict(base) for spec in credible + debunked]

    # Validate counts
    assert len(credible) == 25, f"Expected 25 credible, got {len(credible)}"
    assert len(debunked) == 35, f"Expected 35 debunked, got {len(debunked)}"
    assert len(all_reports) == 60, f"Expected 60 total, got {len(all_reports)}"

    # Validate IDs are unique
    ids = [r["id"] for r in all_reports]
    assert len(ids) == len(set(ids)), f"Duplicate IDs: {ids}"

    return all_reports


def main() -> None:
    dry = "--dry-run" in sys.argv
    reports = generate()

    # Summary
    from collections import Counter
    etype_counts = Counter(r["event_type"] for r in reports)
    city_counts: Counter = Counter()
    for r in reports:
        lat, lon = r["lat"], r["lon"]
        # crude city detection by lat band
        if 47.6 <= lat <= 47.72 and 9.1 <= lon <= 9.25:
            city_counts["Konstanz"] += 1
        elif 48.7 <= lat <= 48.85 and 9.1 <= lon <= 9.3:
            city_counts["Stuttgart"] += 1
        elif 47.9 <= lat <= 48.05 and 7.8 <= lon <= 7.9:
            city_counts["Freiburg"] += 1
        elif 49.0 <= lat <= 49.05 and 8.3 <= lon <= 8.5:
            city_counts["Karlsruhe"] += 1
        else:
            city_counts["Other"] += 1

    credible_count = sum(1 for r in reports if r["exif_timestamp"] is None and r["exif_lat"] is None and "BREAKING" not in r["text"] and "WAKE UP" not in r["text"] and "CLICK HERE" not in r["text"] and "SHARE BEFORE" not in r["text"] and "The media won't" not in r["text"] and "100% CONFIRMED" not in r["text"] and "They're LYING" not in r["text"])
    bot_count = sum(1 for r in reports if any(m in r["text"] for m in ["BREAKING!!!", "SHARE BEFORE", "WAKE UP PEOPLE", "CLICK HERE", "The media won't", "They're LYING"]))
    stale_count = sum(1 for r in reports if r["exif_timestamp"] is not None)
    drift_count = sum(1 for r in reports if r["exif_lat"] is not None)

    print("=" * 60)
    print(f"  VOSTbw Mock Data Generator — {len(reports)} reports")
    print("=" * 60)
    print(f"\n  Credible:  {credible_count}")
    print(f"    Bot-spam:      {bot_count}")
    print(f"    Stale EXIF:    {stale_count}")
    print(f"    Geotag drift:  {drift_count}")
    print(f"\n  Event types ({len(etype_counts)}):")
    for etype, count in etype_counts.most_common():
        print(f"    {etype:25s} {count:3d}")
    print(f"\n  City distribution:")
    for city, count in city_counts.most_common():
        print(f"    {city:20s} {count:3d}")

    if dry:
        print("\n  (--dry-run: no file written)")
        return

    output_path = Path(__file__).parent / "mock_data.json"
    payload = {
        "_comment": (
            "Synthetic OSINT feed for the VOSTbw demo — Konstanz, Stuttgart, "
            "Freiburg, Karlsruhe, 2026-06-12. 60 reports: 25 credible (6 clusters "
            "+ 5 singletons) and 35 deliberately flagged (12 bot-spam, 12 stale EXIF, "
            "11 geotag drift). All accounts, posts and media URLs are fictional. "
            "Timestamps are rebased to 'now' by the backend at startup so the demo "
            "always looks live."
        ),
        "reports": reports,
    }
    output_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\n  ✓ Wrote {output_path}")
    print(f"  Run: cd backend && python -c 'from main import load_raw_reports; r=load_raw_reports(); print(f\"{len(r)} reports loaded\")'")
    print(f"  Then: npm run test:api")


if __name__ == "__main__":
    main()
