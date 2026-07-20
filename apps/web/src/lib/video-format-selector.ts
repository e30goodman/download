import type { VideoFormat } from "@vidbee/downloader-core";

const isMuxedVideoFormat = (format: VideoFormat | undefined): boolean =>
	Boolean(
		format?.vcodec &&
			format.vcodec !== "none" &&
			format.acodec &&
			format.acodec !== "none",
	);

const resolvePreferredAudioExt = (
	videoExt: string | undefined,
): string | undefined => {
	if (!videoExt) {
		return undefined;
	}

	const normalizedExt = videoExt.toLowerCase();
	if (normalizedExt === "mp4") {
		return "m4a";
	}
	if (normalizedExt === "webm") {
		return "webm";
	}
	return undefined;
};

export const buildSingleVideoFormatSelector = (
	formatId: string,
	format: VideoFormat | undefined,
): string => {
	if (!format || isMuxedVideoFormat(format)) {
		return formatId;
	}

	const preferredAudioExt = resolvePreferredAudioExt(format.ext);
	if (!preferredAudioExt) {
		return `${formatId}+bestaudio`;
	}

	return `${formatId}+bestaudio[ext=${preferredAudioExt}]/${formatId}+bestaudio`;
};
