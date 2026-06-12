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

from schemas import RawReport, VerifiedIncident

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
        incidents.append(
            VerifiedIncident(
                id=f"INC-{index:03d}",
                event_type=cluster[0].event_type,
                lat=round(lat, 6),
                lon=round(lon, 6),
                confidence_score=_confidence(len(cluster)),
                source_ids=[r.id for r in cluster],
                report_count=len(cluster),
                first_seen=min(r.timestamp for r in cluster),
                last_seen=max(r.timestamp for r in cluster),
                summary=_summarise(cluster),
            )
        )
    return incidents
