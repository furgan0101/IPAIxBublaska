"""Geospatial clustering: merge corroborating reports into verified incidents.

Rule (all metric): reports describing the same `event_type`, posted within
`TIME_WINDOW` of at least one other cluster member and lying within
`RADIUS_KM` of the cluster centroid, are treated as independent confirmations
of one real-world incident.
"""
from __future__ import annotations

from datetime import timedelta
from statistics import fmean

from geopy.distance import geodesic

from logic.guidance import action_hint, severity_for
from schemas import RawReport, SourceReport, VerifiedIncident

RADIUS_KM: float = 1.0
TIME_WINDOW: timedelta = timedelta(minutes=60)


def _centroid(cluster: list[RawReport]) -> tuple[float, float]:
    return fmean(r.lat for r in cluster), fmean(r.lon for r in cluster)


def _belongs_to(
    report: RawReport,
    cluster: list[RawReport],
    radius_km: float,
    window: timedelta,
) -> bool:
    if report.event_type != cluster[0].event_type:
        return False
    if not any(abs(report.timestamp - other.timestamp) <= window for other in cluster):
        return False
    distance_km = geodesic((report.lat, report.lon), _centroid(cluster)).kilometers
    return distance_km <= radius_km


def _confidence(report_count: int) -> float:
    """More independent sources -> higher confidence, capped below certainty."""
    return round(min(0.50 + 0.12 * report_count, 0.97), 2)


def _summarise(cluster: list[RawReport]) -> str:
    sources = sorted({r.source for r in cluster})
    return (
        f"{cluster[0].event_type.capitalize()} corroborated by "
        f"{len(cluster)} report(s) via {', '.join(sources)}"
    )


def cluster_reports(
    reports: list[RawReport],
    radius_km: float = RADIUS_KM,
    window: timedelta = TIME_WINDOW,
) -> list[VerifiedIncident]:
    """Greedy single-pass clustering; chronological order keeps it deterministic."""
    clusters: list[list[RawReport]] = []
    for report in sorted(reports, key=lambda r: r.timestamp):
        for cluster in clusters:
            if _belongs_to(report, cluster, radius_km, window):
                cluster.append(report)
                break
        else:
            clusters.append([report])

    incidents: list[VerifiedIncident] = []
    for index, cluster in enumerate(clusters, start=1):
        lat, lon = _centroid(cluster)
        ordered = sorted(cluster, key=lambda r: r.timestamp)
        count = len(cluster)
        confidence = _confidence(count)
        event_type = cluster[0].event_type
        incidents.append(
            VerifiedIncident(
                id=f"INC-{index:03d}",
                event_type=event_type,
                lat=round(lat, 6),
                lon=round(lon, 6),
                confidence_score=confidence,
                source_ids=[r.id for r in ordered],
                report_count=count,
                first_seen=ordered[0].timestamp,
                last_seen=ordered[-1].timestamp,
                summary=_summarise(cluster),
                severity=severity_for(event_type),
                action_hint=action_hint(event_type, count, confidence),
                sources=[
                    SourceReport(
                        id=r.id,
                        source=r.source,
                        author=r.author,
                        text=r.text,
                        timestamp=r.timestamp,
                        url=r.url,
                        media_preview=r.first_media_preview(),
                        ai_rationale=r.ai_rationale,
                        ai_media_note=r.ai_media_note,
                    )
                    for r in ordered
                ],
            )
        )
    return incidents
