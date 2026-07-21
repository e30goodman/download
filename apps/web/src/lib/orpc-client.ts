import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import type { downloaderContract } from "@vidbee/downloader-core";
import { ensureResolvedApiUrl, getCachedApiUrl, sleep } from "./api-endpoint";

const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();
const normalizedApiUrl = configuredApiUrl
	? configuredApiUrl.replace(/\/+$/, "")
	: "";
const PUBLIC_SESSION_STORAGE_KEY = "download.public-session-id";
const PUBLIC_SESSION_HEADER = "x-vidbee-session";
const RPC_FETCH_ATTEMPTS = 3;

export const getPublicSessionId = (): string => {
	if (
		typeof window === "undefined" ||
		import.meta.env.VITE_PUBLIC_SITE !== "true"
	) {
		return "";
	}

	const storedSessionId = window.localStorage.getItem(
		PUBLIC_SESSION_STORAGE_KEY,
	);
	if (storedSessionId) {
		return storedSessionId;
	}

	const sessionId = window.crypto.randomUUID();
	window.localStorage.setItem(PUBLIC_SESSION_STORAGE_KEY, sessionId);
	return sessionId;
};

const defaultOrigin =
	typeof window === "undefined"
		? "http://localhost:3000"
		: window.location.origin;
const fallbackApiUrl = normalizedApiUrl || defaultOrigin;

export const getApiUrl = (): string => getCachedApiUrl(fallbackApiUrl);

/** @deprecated Prefer getApiUrl() — kept for existing imports. */
export const apiUrl = fallbackApiUrl;

export const getEventsUrl = (): string => {
	const sessionId = getPublicSessionId();
	const publicSessionQuery = sessionId
		? `?session=${encodeURIComponent(sessionId)}`
		: "";
	return `${getApiUrl()}/events${publicSessionQuery}`;
};

/** @deprecated Prefer getEventsUrl() — kept for existing imports. */
export const eventsUrl = `${fallbackApiUrl}/events${
	getPublicSessionId()
		? `?session=${encodeURIComponent(getPublicSessionId())}`
		: ""
}`;

const resolveRpcBaseUrl = async (): Promise<string> => {
	if (import.meta.env.VITE_PUBLIC_SITE === "true") {
		return ensureResolvedApiUrl(fallbackApiUrl);
	}
	return fallbackApiUrl;
};

export const rpcFetch = async (
	request: Request,
	init: { redirect?: RequestRedirect },
): Promise<Response> => {
	let lastError: unknown;
	const requestTemplate = request.clone();
	for (let attempt = 0; attempt < RPC_FETCH_ATTEMPTS; attempt++) {
		if (requestTemplate.signal.aborted) {
			throw requestTemplate.signal.reason;
		}
		try {
			const baseUrl = await resolveRpcBaseUrl();
			const rewritten = new Request(
				request.url.replace(/^https?:\/\/[^/]+/, baseUrl),
				requestTemplate.clone(),
			);
			const response = await globalThis.fetch(rewritten, init);
			if (
				response.ok ||
				response.status < 500 ||
				attempt === RPC_FETCH_ATTEMPTS - 1
			) {
				return response;
			}
		} catch (error) {
			lastError = error;
			if (attempt < RPC_FETCH_ATTEMPTS - 1) {
				await ensureResolvedApiUrl(fallbackApiUrl, { force: true });
				await sleep(250 * (attempt + 1));
				continue;
			}
			throw error;
		}
		await ensureResolvedApiUrl(fallbackApiUrl, { force: true });
		await sleep(250 * (attempt + 1));
	}
	throw lastError instanceof Error
		? lastError
		: new Error("Failed to reach download API");
};

export const orpcClient: ContractRouterClient<typeof downloaderContract> =
	createORPCClient(
		new RPCLink({
			fetch: (request, init) => rpcFetch(request, init),
			headers: () => {
				const sessionId = getPublicSessionId();
				return sessionId ? { [PUBLIC_SESSION_HEADER]: sessionId } : {};
			},
			url: async () => `${await resolveRpcBaseUrl()}/rpc`,
		}),
	);

export const createBrowserDownloadUrl = (downloadId: string): string => {
	const sessionId = getPublicSessionId();
	const query = sessionId ? `?session=${encodeURIComponent(sessionId)}` : "";
	return `${getApiUrl()}/downloads/${encodeURIComponent(downloadId)}/file${query}`;
};

export const createBrowserBatchDownloadUrl = (
	downloadIds: string[],
): string => {
	const query = new URLSearchParams({
		ids: downloadIds.join(","),
	});
	const sessionId = getPublicSessionId();
	if (sessionId) {
		query.set("session", sessionId);
	}
	return `${getApiUrl()}/downloads/files.zip?${query.toString()}`;
};
