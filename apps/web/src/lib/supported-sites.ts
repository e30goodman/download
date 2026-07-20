export const POPULAR_SITE_KEYS = [
	"youtube",
	"youtubemusic",
	"tiktok",
	"twitter",
	"instagram",
	"facebook",
	"twitch",
	"vimeo",
	"reddit",
	"soundcloud",
	"dailymotion",
	"bandcamp",
	"kick",
	"linkedin",
	"mixcloud",
	"niconico",
	"pinterest",
	"tumblr",
] as const;

export type PopularSiteKey = (typeof POPULAR_SITE_KEYS)[number];

export const HIGHLIGHTED_SITE_LABELS = ["YouTube", "TikTok", "Instagram"] as const;

export const YTDLP_SUPPORTED_SITES_URL =
	"https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md";
