const PLATFORM_LABELS: Record<string, string> = {
	bilibili: "Bilibili",
	facebook: "Facebook",
	instagram: "Instagram",
	niconico: "Niconico",
	reddit: "Reddit",
	soundcloud: "SoundCloud",
	spotify: "Spotify",
	tiktok: "TikTok",
	twitch: "Twitch",
	twitter: "Twitter",
	vimeo: "Vimeo",
	"youtube:tab": "YouTube",
	youtube: "YouTube",
	youtubemusic: "YouTube Music",
};

const formatExtractorLabel = (value: string): string => {
	const normalized = value.trim().toLowerCase();
	if (!normalized) {
		return "";
	}
	return (
		PLATFORM_LABELS[normalized] ??
		normalized.charAt(0).toUpperCase() + normalized.slice(1)
	);
};

const resolvePlatformFromUrl = (url: string): string | null => {
	try {
		const hostname = new URL(url).hostname.toLowerCase();
		if (hostname.includes("youtube.com") || hostname.includes("youtu.be")) {
			return hostname.includes("music") ? "YouTube Music" : "YouTube";
		}
		if (hostname.includes("twitter.com") || hostname === "x.com") {
			return "Twitter";
		}
		if (hostname.includes("instagram.com")) {
			return "Instagram";
		}
		if (hostname.includes("tiktok.com")) {
			return "TikTok";
		}
		if (hostname.includes("facebook.com") || hostname.includes("fb.watch")) {
			return "Facebook";
		}
		if (hostname.includes("twitch.tv")) {
			return "Twitch";
		}
		if (hostname.includes("vimeo.com")) {
			return "Vimeo";
		}
		if (hostname.includes("bilibili.com")) {
			return "Bilibili";
		}
		if (hostname.includes("spotify.com")) {
			return "Spotify";
		}
		if (hostname.includes("soundcloud.com")) {
			return "SoundCloud";
		}
	} catch {
		return null;
	}
	return null;
};

export const resolvePlatformLabel = (input: {
	channel?: string;
	url?: string;
}): string | null => {
	const channelLabel = input.channel ? formatExtractorLabel(input.channel) : "";
	if (channelLabel) {
		return channelLabel;
	}
	const url = input.url?.trim();
	if (!url) {
		return null;
	}
	return resolvePlatformFromUrl(url);
};
