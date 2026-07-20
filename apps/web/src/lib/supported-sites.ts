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

export const POPULAR_SITE_URLS: Record<PopularSiteKey, string> = {
	youtube: "https://www.youtube.com/",
	youtubemusic: "https://music.youtube.com/",
	tiktok: "https://www.tiktok.com/",
	twitter: "https://x.com/",
	instagram: "https://www.instagram.com/",
	facebook: "https://www.facebook.com/",
	twitch: "https://www.twitch.tv/",
	vimeo: "https://vimeo.com/",
	reddit: "https://www.reddit.com/",
	soundcloud: "https://soundcloud.com/",
	dailymotion: "https://www.dailymotion.com/",
	bandcamp: "https://bandcamp.com/",
	kick: "https://kick.com/",
	linkedin: "https://www.linkedin.com/",
	mixcloud: "https://www.mixcloud.com/",
	niconico: "https://www.nicovideo.jp/",
	pinterest: "https://www.pinterest.com/",
	tumblr: "https://www.tumblr.com/",
};

export const HIGHLIGHTED_SITE_KEYS = [
	"youtube",
	"tiktok",
	"instagram",
] as const satisfies readonly PopularSiteKey[];

export const HIGHLIGHTED_SITE_LABELS = ["YouTube", "TikTok", "Instagram"] as const;

export const YTDLP_SUPPORTED_SITES_URL =
	"https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md";
