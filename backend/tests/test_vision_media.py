"""Vision + media pipeline tests — mocked gateway and mocked HTTP, ZERO network.

Covers the gateway's verified constraints: base64 data-URI construction
(remote URLs are blocked by the gateway), media-download failure -> text-only
fallback, API-key rotation on quota errors, and that the UI-facing fields
(rationale, media_consistency, media_preview) are populated end-to-end.
"""
from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any

import pytest
from openai import OpenAIError

from ingestion.mastodon import _to_item
from logic import verification
from schemas import MediaItem, RawReport

NOW = datetime(2026, 6, 12, 14, 0, tzinfo=timezone.utc)

JPEG_BYTES = b"\xff\xd8\xff\xe1" + b"x" * 200
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"x" * 200

CREDIBLE_JSON = (
    '{"is_credible": true, "event_type": "flood", "credibility_score": 0.81,'
    ' "reason_flagged": null, "rationale": "Specific street-level detail, calm tone.",'
    ' "media_consistency": "Photo shows lakeside flooding consistent with the claim."}'
)
DEBUNK_JSON = (
    '{"is_credible": false, "event_type": "fire", "credibility_score": 0.1,'
    ' "reason_flagged": "Imagery does not match the claimed scene",'
    ' "rationale": "The attached photo shows a different city skyline.",'
    ' "media_consistency": "Image inconsistent with the claimed location."}'
)


@pytest.fixture(autouse=True)
def _default_mock_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    """Deterministic + offline by default; tests opt into (fake) live mode."""
    for var in (
        "LITELLM_API_KEY",
        "LITELLM_API_KEYS",
        "USE_LIVE_AI",
        "USE_VISION",
        "LLM_MAX_CALLS",
    ):
        monkeypatch.delenv(var, raising=False)
    verification.reset_call_budget()


def make_report(**overrides: object) -> RawReport:
    base: dict[str, object] = {
        "id": "RPT-V1",
        "source": "mastodon",
        "author": "@test",
        "text": "Uferweg am Stadtgarten überflutet, Foto anbei",
        "event_type": "flood",
        "lat": 47.6603,
        "lon": 9.1758,
        "timestamp": NOW,
    }
    base.update(overrides)
    return RawReport.model_validate(base)


class _FakeClient:
    """Canned chat completion; records every create() call's kwargs."""

    def __init__(self, payload: str) -> None:
        self.calls: list[dict[str, Any]] = []

        def _create(**kwargs: Any) -> object:
            self.calls.append(kwargs)
            message = SimpleNamespace(content=payload)
            return SimpleNamespace(choices=[SimpleNamespace(message=message)])

        self.chat = SimpleNamespace(completions=SimpleNamespace(create=_create))


class _QuotaError(OpenAIError):
    """Stands in for a 429 from the gateway."""

    status_code = 429


class _QuotaClient:
    def __init__(self) -> None:
        def _create(**_: Any) -> object:
            raise _QuotaError("quota exceeded")

        self.chat = SimpleNamespace(completions=SimpleNamespace(create=_create))


def _enable_live(
    monkeypatch: pytest.MonkeyPatch, *, vision: bool = False
) -> None:
    monkeypatch.setenv("LITELLM_API_KEY", "test-key")
    monkeypatch.setenv("USE_LIVE_AI", "true")
    if vision:
        monkeypatch.setenv("USE_VISION", "true")


# --- mime sniffing + data-URI construction ------------------------------------------


def test_sniff_mime_by_magic_bytes() -> None:
    assert verification._sniff_mime(JPEG_BYTES, "") == "image/jpeg"
    assert verification._sniff_mime(PNG_BYTES, "application/octet-stream") == "image/png"
    assert verification._sniff_mime(b"GIF89a" + b"x" * 50, "") == "image/gif"
    assert (
        verification._sniff_mime(b"RIFF1234WEBP" + b"x" * 50, "") == "image/webp"
    )


def test_sniff_mime_falls_back_to_header_then_rejects() -> None:
    assert verification._sniff_mime(b"\x00" * 50, "image/avif") == "image/avif"
    with pytest.raises(ValueError):
        verification._sniff_mime(b"<html>not an image</html>", "text/html")


def test_data_uri_built_from_downloaded_bytes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        verification, "_http_get_bytes", lambda url: (JPEG_BYTES, "image/jpeg")
    )
    uri = verification._media_data_uri("https://example.org/photo.jpg")
    assert uri.startswith("data:image/jpeg;base64,")


def test_data_uri_rejects_error_pages_and_oversize(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        verification, "_http_get_bytes", lambda url: (b"tiny", "image/jpeg")
    )
    with pytest.raises(ValueError):
        verification._media_data_uri("https://example.org/x.jpg")
    big = JPEG_BYTES + b"x" * verification.MAX_MEDIA_BYTES
    monkeypatch.setattr(
        verification, "_http_get_bytes", lambda url: (big, "image/jpeg")
    )
    with pytest.raises(ValueError):
        verification._media_data_uri("https://example.org/x.jpg")


# --- vision call construction ---------------------------------------------------------


def test_vision_attaches_base64_data_uri(monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_live(monkeypatch, vision=True)
    fake = _FakeClient(CREDIBLE_JSON)
    monkeypatch.setattr(verification, "_client_for", lambda key: fake)
    monkeypatch.setattr(
        verification, "_http_get_bytes", lambda url: (JPEG_BYTES, "image/jpeg")
    )
    report = make_report(
        media=[MediaItem(url="https://files.mstdn/img.jpeg", type="image")]
    )

    assessment = verification.assess_report(report)

    assert assessment.credible
    assert assessment.media_consistency is not None
    assert assessment.analyzed_media == "https://files.mstdn/img.jpeg"
    content = fake.calls[0]["messages"][1]["content"]
    assert isinstance(content, list)
    image_part = content[1]["image_url"]["url"]
    assert image_part.startswith("data:image/jpeg;base64,")  # never the remote URL
    assert "attached image is included" in fake.calls[0]["messages"][0]["content"]


def test_video_uses_preview_frame(monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_live(monkeypatch, vision=True)
    fake = _FakeClient(CREDIBLE_JSON)
    monkeypatch.setattr(verification, "_client_for", lambda key: fake)
    monkeypatch.setattr(
        verification, "_http_get_bytes", lambda url: (JPEG_BYTES, "image/jpeg")
    )
    report = make_report(
        media=[
            MediaItem(
                url="https://files.mstdn/clip.mp4",
                type="video",
                preview_url="https://files.mstdn/clip_frame.jpg",
            )
        ]
    )

    assessment = verification.assess_report(report)

    assert assessment.analyzed_media == "https://files.mstdn/clip_frame.jpg"
    system_prompt = fake.calls[0]["messages"][0]["content"]
    assert "representative frame" in system_prompt


def test_media_download_failure_falls_back_to_text_only(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable_live(monkeypatch, vision=True)
    fake = _FakeClient(CREDIBLE_JSON)
    monkeypatch.setattr(verification, "_client_for", lambda key: fake)

    def _boom(url: str) -> tuple[bytes, str]:
        raise ValueError("connection refused")

    monkeypatch.setattr(verification, "_http_get_bytes", _boom)
    report = make_report(
        media=[MediaItem(url="https://files.mstdn/gone.jpg", type="image")]
    )

    assessment = verification.assess_report(report)

    assert assessment.credible  # the report is still analyzed, just text-only
    assert assessment.media_consistency is None
    assert assessment.analyzed_media is None
    content = fake.calls[0]["messages"][1]["content"]
    assert isinstance(content, str)  # plain text — no image part attached


# --- key rotation -----------------------------------------------------------------------


def test_key_rotation_on_quota_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LITELLM_API_KEYS", "key-one,key-two")
    monkeypatch.setenv("USE_LIVE_AI", "true")
    good = _FakeClient(CREDIBLE_JSON)
    used: list[str] = []

    def _client_for(key: str) -> object:
        used.append(key)
        return _QuotaClient() if key == "key-one" else good

    monkeypatch.setattr(verification, "_client_for", _client_for)
    monkeypatch.setattr(verification, "_preferred_key_index", 0)

    assessment = verification.assess_report(make_report())

    assert assessment.credible
    assert used == ["key-one", "key-two"]  # rotated past the quota-limited key


def test_all_keys_exhausted_falls_back_to_heuristics(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LITELLM_API_KEYS", "key-one,key-two")
    monkeypatch.setenv("USE_LIVE_AI", "true")
    monkeypatch.setattr(verification, "_client_for", lambda key: _QuotaClient())
    monkeypatch.setattr(verification, "_preferred_key_index", 0)

    assessment = verification.assess_report(make_report())

    assert assessment.credible  # graceful degradation to heuristics
    assert assessment.score == pytest.approx(0.90)


# --- UI-facing fields flow through the pipeline -------------------------------------------


def test_debunked_carries_rationale_media_note_and_preview(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable_live(monkeypatch, vision=True)
    fake = _FakeClient(DEBUNK_JSON)
    monkeypatch.setattr(verification, "_client_for", lambda key: fake)
    monkeypatch.setattr(
        verification, "_http_get_bytes", lambda url: (JPEG_BYTES, "image/jpeg")
    )
    report = make_report(
        media=[
            MediaItem(
                url="https://files.mstdn/fake.jpg",
                type="image",
                preview_url="https://files.mstdn/fake_small.jpg",
            )
        ]
    )

    credible, debunked = verification.filter_reports([report])

    assert credible == []
    item = debunked[0]
    assert item.rationale == "The attached photo shows a different city skyline."
    assert item.media_consistency == "Image inconsistent with the claimed location."
    assert item.media_preview == "https://files.mstdn/fake_small.jpg"


def test_verified_source_carries_ai_annotations(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable_live(monkeypatch, vision=True)
    fake = _FakeClient(CREDIBLE_JSON)
    monkeypatch.setattr(verification, "_client_for", lambda key: fake)
    monkeypatch.setattr(
        verification, "_http_get_bytes", lambda url: (JPEG_BYTES, "image/jpeg")
    )
    report = make_report(
        media=[MediaItem(url="https://files.mstdn/img.jpg", type="image")]
    )

    credible, _ = verification.filter_reports([report])

    assert credible[0].ai_rationale == "Specific street-level detail, calm tone."
    assert credible[0].ai_media_note is not None
    assert credible[0].first_media_preview() == "https://files.mstdn/img.jpg"


# --- connector media extraction -----------------------------------------------------------


def test_mastodon_maps_video_attachment_with_preview() -> None:
    status = {
        "id": "1",
        "uri": "https://mstdn.example/status/1",
        "created_at": "2026-06-12T13:00:00Z",
        "language": "de",
        "content": "<p>Unwetter über dem Bodensee, Video vom Hafen Konstanz</p>",
        "account": {"acct": "seeblick"},
        "media_attachments": [
            {
                "type": "video",
                "url": "https://files.mstdn/storm.mp4",
                "preview_url": "https://files.mstdn/storm_frame.jpg",
            }
        ],
    }
    item = _to_item(status)
    assert item is not None
    assert item.media[0].type == "video"
    assert item.media[0].preview_url == "https://files.mstdn/storm_frame.jpg"
    assert item.media_url == "https://files.mstdn/storm_frame.jpg"


def test_call_budget_halts_spend_after_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LITELLM_API_KEY", "k")
    monkeypatch.setenv("USE_LIVE_AI", "true")
    monkeypatch.setenv("LLM_MAX_CALLS", "1")
    verification.reset_call_budget()
    monkeypatch.setattr(
        verification, "_client_for", lambda key: _FakeClient(CREDIBLE_JSON)
    )

    first = verification.assess_report(make_report(id="A"))
    second = verification.assess_report(make_report(id="B"))

    assert first.rationale == "Specific street-level detail, calm tone."  # used LLM
    assert second.rationale is None  # cap hit -> heuristic fallback
    assert second.score == pytest.approx(0.90)  # heuristic "credible" score
    assert verification.llm_calls_made() == 1  # the budget held the line


def test_budget_zero_means_unlimited(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LITELLM_API_KEY", "k")
    monkeypatch.setenv("USE_LIVE_AI", "true")
    monkeypatch.setenv("LLM_MAX_CALLS", "0")
    verification.reset_call_budget()
    monkeypatch.setattr(
        verification, "_client_for", lambda key: _FakeClient(CREDIBLE_JSON)
    )
    for n in range(5):
        assert verification.assess_report(make_report(id=f"R{n}")).rationale is not None
    assert verification.llm_calls_made() == 5


def test_mastodon_falls_back_to_link_card_image() -> None:
    status = {
        "id": "2",
        "uri": "https://mstdn.example/status/2",
        "created_at": "2026-06-12T13:05:00Z",
        "language": "de",
        "content": "<p>Pressemitteilung zur Hochwasserlage in Konstanz, Details im Link</p>",
        "account": {"acct": "kn_news"},
        "media_attachments": [],
        "card": {"image": "https://news.example/lead.jpg"},
    }
    item = _to_item(status)
    assert item is not None
    assert item.media[0].url == "https://news.example/lead.jpg"
    assert item.media[0].type == "image"
