import type { DownloadType } from "@vidbee/downloader-core";
import type { DownloadRecord } from "../components/download/types";
import { siteConfig } from "./site-config";

export interface ShareDownloadParams {
	url: string;
	type?: DownloadType;
	formatId?: string;
}

const SHARE_PARAM_URL = "url";
const SHARE_PARAM_TYPE = "type";
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
	formatId,
}: ShareDownloadParams): string => {
	const shareUrl = new URL(getShareBaseUrl());
	shareUrl.searchParams.set(SHARE_PARAM_URL, url.trim());
	if (type) {
		shareUrl.searchParams.set(SHARE_PARAM_TYPE, type);
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
		formatId: download.selectedFormat?.formatId,
	});
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
	const formatId = params.get(SHARE_PARAM_FORMAT)?.trim() || undefined;

	return { url, type, formatId };
};
