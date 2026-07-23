import { ensureResolvedApiUrl } from "./api-endpoint";
import { getApiUrl } from "./orpc-client";

const IMAGE_PROXY_PATH = "images/proxy";
const configuredApiUrl = import.meta.env.VITE_API_URL?.trim() ?? "";

export const buildImageProxyUrl = (sourceUrl: string): string => {
	const proxyUrl = new URL(`${getApiUrl()}/${IMAGE_PROXY_PATH}`);
	proxyUrl.searchParams.set("url", sourceUrl);
	return proxyUrl.toString();
};

export const resolveImageProxyUrl = async (
	sourceUrl: string,
): Promise<string> => {
	if (import.meta.env.VITE_PUBLIC_SITE === "true") {
		await ensureResolvedApiUrl(configuredApiUrl || getApiUrl());
	}
	return buildImageProxyUrl(sourceUrl);
};
