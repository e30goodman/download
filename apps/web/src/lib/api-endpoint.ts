const ENDPOINT_CACHE_TTL_MS = 30_000;
const HEALTH_PROBE_TIMEOUT_MS = 4_000;
const RAW_ENDPOINT_URL =
	"https://raw.githubusercontent.com/e30goodman/download/main/api-endpoint.json";

let cachedApiUrl = "";
let cachedAt = 0;
let inflight: Promise<string> | null = null;

interface ApiEndpoint {
	url: string;
	updatedAt: number;
}

const normalizeApiUrl = (value: string | undefined | null): string => {
	const trimmed = value?.trim() ?? "";
	if (!trimmed) {
		return "";
	}
	return trimmed.replace(/\/+$/, "");
};

const readEndpointPayload = async (
	url: string,
	fetchImpl: typeof fetch,
): Promise<ApiEndpoint | null> => {
	const response = await fetchImpl(url, {
		cache: "no-store",
		headers: { Accept: "application/json" },
	});
	if (!response.ok) {
		return null;
	}
	const payload = (await response.json()) as {
		url?: unknown;
		updatedAt?: unknown;
	};
	if (typeof payload.url !== "string") {
		return null;
	}

	const normalizedUrl = normalizeApiUrl(payload.url);
	if (!normalizedUrl) {
		return null;
	}

	const updatedAt =
		typeof payload.updatedAt === "string"
			? Date.parse(payload.updatedAt)
			: Number.NaN;
	return {
		url: normalizedUrl,
		updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
	};
};

const probeApiHealth = async (
	apiUrl: string,
	fetchImpl: typeof fetch,
): Promise<boolean> => {
	const controller = new AbortController();
	const timer = globalThis.setTimeout(() => {
		controller.abort();
	}, HEALTH_PROBE_TIMEOUT_MS);
	try {
		const response = await fetchImpl(`${apiUrl}/health`, {
			cache: "no-store",
			signal: controller.signal,
		});
		if (!response.ok) {
			return false;
		}
		const payload = (await response.json()) as { ok?: unknown };
		return payload.ok === true;
	} catch {
		return false;
	} finally {
		globalThis.clearTimeout(timer);
	}
};

const resolveFromSources = async (
	fallbackUrl: string,
	fetchImpl: typeof fetch,
): Promise<string> => {
	const candidates: string[] = [];

	if (typeof window !== "undefined") {
		const basePath = (import.meta.env.VITE_BASE_PATH ?? "/").replace(
			/\/?$/,
			"/",
		);
		candidates.push(
			new URL("api-endpoint.json", `${window.location.origin}${basePath}`).href,
		);
		candidates.push(new URL("api-endpoint.json", window.location.href).href);
	}

	candidates.push(`${RAW_ENDPOINT_URL}?t=${Date.now()}`);

	const endpoints = await Promise.all(
		candidates.map(async (candidate) => {
			try {
				return await readEndpointPayload(candidate, fetchImpl);
			} catch {
				return null;
			}
		}),
	);

	const uniqueByUrl = new Map<string, ApiEndpoint>();
	for (const endpoint of endpoints) {
		if (!endpoint) {
			continue;
		}
		const previous = uniqueByUrl.get(endpoint.url);
		if (!previous || endpoint.updatedAt > previous.updatedAt) {
			uniqueByUrl.set(endpoint.url, endpoint);
		}
	}

	const ranked = [...uniqueByUrl.values()].sort(
		(left, right) => right.updatedAt - left.updatedAt,
	);
	const fallback = normalizeApiUrl(fallbackUrl);
	if (fallback && !uniqueByUrl.has(fallback)) {
		ranked.push({ url: fallback, updatedAt: 0 });
	}

	for (const endpoint of ranked) {
		if (await probeApiHealth(endpoint.url, fetchImpl)) {
			return endpoint.url;
		}
	}

	return ranked[0]?.url ?? fallback;
};

export const getCachedApiUrl = (fallbackUrl: string): string =>
	cachedApiUrl || normalizeApiUrl(fallbackUrl);

export const ensureResolvedApiUrl = async (
	fallbackUrl: string,
	options: {
		force?: boolean;
		fetchImpl?: typeof fetch;
	} = {},
): Promise<string> => {
	const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
	const now = Date.now();
	if (
		!options.force &&
		cachedApiUrl &&
		now - cachedAt < ENDPOINT_CACHE_TTL_MS
	) {
		return cachedApiUrl;
	}

	if (inflight && !options.force) {
		return inflight;
	}

	inflight = (async () => {
		const resolved = await resolveFromSources(fallbackUrl, fetchImpl);
		cachedApiUrl = resolved || normalizeApiUrl(fallbackUrl);
		cachedAt = Date.now();
		return cachedApiUrl;
	})();

	try {
		return await inflight;
	} finally {
		inflight = null;
	}
};

export const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		globalThis.setTimeout(resolve, ms);
	});
