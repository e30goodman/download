"""yt-dlp plugin: route Threads post URLs through InstagramIE.

yt-dlp has no Threads extractor. Threads posts reuse Instagram shortcodes, so
hand the request to InstagramIE via url_result.
"""

from __future__ import annotations

from yt_dlp.extractor.common import InfoExtractor


class ThreadsIE(InfoExtractor):
    IE_NAME = "threads"
    IE_DESC = "Threads posts (routed to Instagram)"
    _VALID_URL = (
        r"https?://(?:www\.)?threads\.(?:net|com)/"
        r"(?:(?:@[^/?#]+/)?(?:post|t)/|t/)(?P<id>[A-Za-z0-9_-]+)"
    )
    _TESTS = [
        {
            "url": "https://www.threads.com/@user/post/DbVLrkkALlv",
            "only_matching": True,
        },
        {
            "url": "https://www.threads.net/t/CuXnwmrMIZL",
            "only_matching": True,
        },
        {
            "url": "https://www.threads.net/@tntsportsbr/post/C6cqebdCfBi",
            "only_matching": True,
        },
    ]

    def _real_extract(self, url):
        shortcode = self._match_id(url)
        # Strip tracking query params by rebuilding a clean Instagram media URL.
        return self.url_result(
            f"https://www.instagram.com/p/{shortcode}/",
            ie="Instagram",
            video_id=shortcode,
        )
