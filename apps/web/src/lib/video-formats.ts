import type { DownloadType, VideoFormat } from "@vidbee/downloader-core";

const getFileSize = (format: VideoFormat): number =>
	format.filesize ?? format.filesizeApprox ?? 0;

const isVideoFormat = (format: VideoFormat): boolean =>
	Boolean(format.vcodec && format.vcodec !== "none");

const isAudioFormat = (format: VideoFormat): boolean =>
	Boolean(
		format.acodec &&
			format.acodec !== "none" &&
			(format.videoExt === "none" ||
				!format.videoExt ||
				!format.vcodec ||
				format.vcodec === "none"),
	);

const sortVideoFormatsByQuality = (a: VideoFormat, b: VideoFormat): number => {
	const aHeight = a.height ?? 0;
	const bHeight = b.height ?? 0;
	if (aHeight !== bHeight) {
		return bHeight - aHeight;
	}
	const aFps = a.fps ?? 0;
	const bFps = b.fps ?? 0;
	if (aFps !== bFps) {
		return bFps - aFps;
	}
	return getFileSize(b) - getFileSize(a);
};

const sortAudioFormatsByQuality = (a: VideoFormat, b: VideoFormat): number => {
	const aQuality = a.tbr ?? a.quality ?? 0;
	const bQuality = b.tbr ?? b.quality ?? 0;
	if (aQuality !== bQuality) {
		return bQuality - aQuality;
	}
	return getFileSize(b) - getFileSize(a);
};

export const getSelectableFormats = (
	formats: VideoFormat[] | undefined,
	type: DownloadType,
): VideoFormat[] => {
	if (!formats || type === "text") {
		return [];
	}

	if (type === "audio") {
		return formats
			.filter(isAudioFormat)
			.sort(sortAudioFormatsByQuality)
			.slice(0, 24);
	}

	const groupedByHeight = new Map<number, VideoFormat[]>();
	for (const format of formats.filter(isVideoFormat)) {
		const height = format.height ?? 0;
		const existing = groupedByHeight.get(height) ?? [];
		existing.push(format);
		groupedByHeight.set(height, existing);
	}

	return Array.from(groupedByHeight.values())
		.map((group) => group.sort((a, b) => getFileSize(b) - getFileSize(a))[0])
		.sort(sortVideoFormatsByQuality)
		.slice(0, 24);
};

export const formatVideoQualityLabel = (format: VideoFormat): string => {
	if (format.height) {
		return `${format.height}p${format.fps === 60 ? "60" : ""}`;
	}
	if (format.formatNote) {
		return format.formatNote;
	}
	if (typeof format.quality === "number") {
		return format.quality.toString();
	}
	return format.formatId;
};

export const formatAudioQualityLabel = (format: VideoFormat): string => {
	if (format.tbr) {
		return `${Math.round(format.tbr)} kbps`;
	}
	if (format.formatNote) {
		return format.formatNote;
	}
	if (typeof format.quality === "number") {
		return format.quality.toString();
	}
	return format.formatId;
};

export const formatCodecSummary = (format: VideoFormat): string => {
	const parts: string[] = [format.ext.toUpperCase()];
	if (format.vcodec && format.vcodec !== "none") {
		parts.push(format.vcodec.split(".")[0].toUpperCase());
	}
	if (format.acodec && format.acodec !== "none") {
		parts.push(format.acodec.split(".")[0].toUpperCase());
	}
	return parts.join(" · ");
};
