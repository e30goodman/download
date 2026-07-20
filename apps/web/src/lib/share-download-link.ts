import type { DownloadType } from "@vidbee/downloader-core";
import type { DownloadRecord } from "../components/download/types";
import {
	inferRowFormatPreset,
	type RowFormatPreset,
} from "./row-format-presets";
import { siteConfig } from "./site-config";

export interface ShareDownloadParams {
	url: string;
	type?: DownloadType;
	preset?: RowFormatPreset;
	formatId?: string;
}

const SHARE_PARAM_URL = "url";
const SHARE_PARAM_TYPE = "type";
const SHARE_PARAM_PRESET = "preset";
const SHARE_PARAM_FORMAT = "format";

export const getShareBaseUrl = (): string => {
	if (typeof window === "undefined") {
		return siteConfig.publicUrl;
	}

	if (siteConfig.isPublicSite) {
		return siteConfig.publicUrl;
	}

	const configuredBase = import.meta.env.VITE_BASE_PATH?.trim() || "/";
	const normalizedBase = configuredBase.startsWith("/")
		? configuredBase
		: `/${configuredBase}`;
	const withTrailingSlash = normalizedBase.endsWith("/")
		? normalizedBase
		: `${normalizedBase}/`;
	return `${window.location.origin}${withTrailingSlash}`;
};

export const buildShareDownloadUrl = ({
	url,
	type,
	preset,
	formatId,
}: ShareDownloadParams): string => {
	const shareUrl = new URL(getShareBaseUrl());
	shareUrl.searchParams.set(SHARE_PARAM_URL, url.trim());
	if (type) {
		shareUrl.searchParams.set(SHARE_PARAM_TYPE, type);
	}
	if (preset) {
		shareUrl.searchParams.set(SHARE_PARAM_PRESET, preset);
	}
	if (formatId) {
		shareUrl.searchParams.set(SHARE_PARAM_FORMAT, formatId);
	}
	return shareUrl.toString();
};

export const buildShareDownloadUrlFromRecord = (
	download: DownloadRecord,
): string | null => {
	const url = download.url?.trim();
	if (!url) {
		return null;
	}

	return buildShareDownloadUrl({
		url,
		type: download.type,
		preset: inferRowFormatPreset(download),
	});
};

const parsePreset = (
	value: string | null | undefined,
): RowFormatPreset | undefined => {
	if (!value) {
		return undefined;
	}
	if (
		value === "original" ||
		value === "1080" ||
		value === "720" ||
		value === "360" ||
		value === "mp3" ||
		value === "wav" ||
		value === "txt" ||
		value === "md"
	) {
		return value;
	}
	return undefined;
};

export const parseShareDownloadParams = (
	search: string,
): ShareDownloadParams | null => {
	const params = new URLSearchParams(
		search.startsWith("?") ? search.slice(1) : search,
	);
	const url = params.get(SHARE_PARAM_URL)?.trim();
	if (!url) {
		return null;
	}

	const typeParam = params.get(SHARE_PARAM_TYPE)?.trim();
	const type =
		typeParam === "video" ||
		typeParam === "audio" ||
		typeParam === "text"
			? typeParam
			: undefined;
	const preset = parsePreset(params.get(SHARE_PARAM_PRESET));
	const formatId = params.get(SHARE_PARAM_FORMAT)?.trim() || undefined;

	return { url, type, preset, formatId };
};
