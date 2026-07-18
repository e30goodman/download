import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import type { downloaderContract } from "@vidbee/downloader-core";

const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();
const normalizedApiUrl = configuredApiUrl
	? configuredApiUrl.replace(/\/+$/, "")
	: "";
const PUBLIC_SESSION_STORAGE_KEY = "download.public-session-id";
const PUBLIC_SESSION_HEADER = "x-vidbee-session";

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
export const apiUrl = normalizedApiUrl || defaultOrigin;

const publicSessionId = getPublicSessionId();
const publicSessionQuery = publicSessionId
	? `?session=${encodeURIComponent(publicSessionId)}`
	: "";
export const eventsUrl = `${apiUrl}/events${publicSessionQuery}`;
const rpcUrl = `${apiUrl}/rpc`;

export const orpcClient: ContractRouterClient<typeof downloaderContract> =
	createORPCClient(
		new RPCLink({
			headers: () => {
				const sessionId = getPublicSessionId();
				return sessionId ? { [PUBLIC_SESSION_HEADER]: sessionId } : {};
			},
			url: rpcUrl,
		}),
	);

export const createBrowserDownloadUrl = (downloadId: string): string => {
	const sessionId = getPublicSessionId();
	const query = sessionId ? `?session=${encodeURIComponent(sessionId)}` : "";
	return `${apiUrl}/downloads/${encodeURIComponent(downloadId)}/file${query}`;
};
