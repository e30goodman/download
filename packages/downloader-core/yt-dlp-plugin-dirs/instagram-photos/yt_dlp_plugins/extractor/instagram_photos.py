"""yt-dlp plugin: download Instagram photo posts as still images.

Upstream InstagramIE only exposes video streams and raises
"There is no video in this post" for photo / ad image posts. Patch
`_extract_product_media` so `image_versions2` / `display_uri` become
regular formats (ext=jpg, acodec=none).
"""

from __future__ import annotations

from yt_dlp.extractor.instagram import InstagramIE
from yt_dlp.utils import int_or_none, traverse_obj, url_or_none, join_nonempty

_original_extract_product_media = InstagramIE._extract_product_media


def _image_formats(product_media: dict) -> list[dict]:
    formats = traverse_obj(
        product_media,
        (
            "image_versions2",
            "candidates",
            lambda _, v: url_or_none(v["url"]),
            {
                "url": "url",
                "width": ("width", {int_or_none}),
                "height": ("height", {int_or_none}),
            },
        ),
    ) or []

    display_uri = url_or_none(product_media.get("display_uri"))
    if display_uri and not any(f.get("url") == display_uri for f in formats):
        formats.append(
            {
                "url": display_uri,
                "width": int_or_none(product_media.get("original_width")),
                "height": int_or_none(product_media.get("original_height")),
            }
        )

    result: list[dict] = []
    seen: set[str] = set()
    for index, fmt in enumerate(formats):
        url = fmt.get("url")
        if not url or url in seen:
            continue
        seen.add(url)
        width = fmt.get("width")
        height = fmt.get("height")
        result.append(
            {
                "url": url,
                "width": width,
                "height": height,
                "ext": "jpg",
                "format_id": join_nonempty("img", width, height, delim="") or f"img{index}",
                "vcodec": "jpg",
                "acodec": "none",
                "protocol": "https",
                "preference": (width or 0) * (height or 0),
            }
        )
    return result


def _extract_product_media_with_images(self, product_media):
    info = _original_extract_product_media(self, product_media)
    if info.get("formats"):
        return info

    image_formats = _image_formats(product_media if isinstance(product_media, dict) else {})
    if not image_formats:
        return info

    info["formats"] = image_formats
    info.setdefault("ext", "jpg")
    # Prefer the largest still when callers ask for "best".
    info.setdefault("format_id", image_formats[-1].get("format_id"))
    return info


InstagramIE._extract_product_media = _extract_product_media_with_images
