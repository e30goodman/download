import type {
	CreateDownloadInput,
	DeliveryServerReason,
	DownloadRuntimeSettings,
	ResolveDeliveryInput,
	ResolveDeliveryOutput,
	VideoFormat,
} from "@vidbee/downloader-core";
import { orpcClient } from "./orpc-client";

const DEFAULT_PROBE_TIMEOUT_MS = 5000;
const MAX_FILENAME_LENGTH = 180;
const FORBIDDEN_FILENAME_CHARACTERS = new Set('<>:"/\\|?*');
const SPECIAL_HOST_SUFFIXES = [
	".arpa",
	".example",
	".home",
	".internal",
	".invalid",
	".lan",
	".local",
	".localdomain",
	".localhost",
	".onion",
	".test",
] as const;

export interface DirectDownloadMetadata {
	filename: string;
	mime?: string;
	contentLength?: number;
	expiresAt?: string;
}

export type BrowserDeliveryResult =
	| {
			outcome: "handed-off";
			metadata: DirectDownloadMetadata;
	  }
	| {
			outcome: "queued";
			reason?: DeliveryServerReason;
	  };

export interface BrowserDeliveryInput {
	resolve: ResolveDeliveryInput;
	fallback: CreateDownloadInput;
}

interface DeliveryDependencies {
	resolveDelivery?: (
		input: ResolveDeliveryInput,
	) => Promise<ResolveDeliveryOutput>;
	createDownload?: (input: CreateDownloadInput) => Promise<unknown>;
	fetchImpl?: typeof fetch;
	documentRef?: Document;
	probeTimeoutMs?: number;
}

export interface DirectProbeResult {
	finalUrl: string;
	contentType?: string;
	filename?: string;
}

const isMuxedHttpFormat = (format: VideoFormat | undefined): boolean => {
	if (!format) {
		return false;
	}

	const protocol = format.protocol?.trim().toLowerCase();
	const videoCodec = format.vcodec?.trim().toLowerCase();
	const audioCodec = format.acodec?.trim().toLowerCase();
	return (
		(protocol === "http" || protocol === "https") &&
		Boolean(videoCodec && videoCodec !== "none") &&
		Boolean(audioCodec && audioCodec !== "none")
	);
};

const hasValue = (value: string | null | undefined): boolean =>
	typeof value === "string" && value.trim().length > 0;

const settingsAllowDirectDelivery = (
	settings: DownloadRuntimeSettings | undefined,
): boolean => {
	const browserForCookies = settings?.browserForCookies?.trim();
	return !(
		(settings?.embedSubs ?? true) ||
		(settings?.embedMetadata ?? true) ||
		(settings?.embedChapters ?? true) ||
		(settings?.embedThumbnail ?? false) ||
		(browserForCookies && browserForCookies !== "none") ||
		settings?.cookiesPath?.trim() ||
		settings?.proxy?.trim() ||
		settings?.configPath?.trim()
	);
};

export const isDirectDownloadEligible = ({
	isPublicSite,
	type,
	format,
	settings,
	audioFormat,
	audioFormatIds,
	startTime,
	endTime,
	containerFormat,
}: {
	isPublicSite: boolean;
	type: "video" | "audio";
	format: VideoFormat | undefined;
	settings?: DownloadRuntimeSettings;
	audioFormat?: string;
	audioFormatIds?: string[];
	startTime?: string;
	endTime?: string;
	containerFormat?: ResolveDeliveryInput["containerFormat"];
}): boolean =>
	isPublicSite &&
	type === "video" &&
	isMuxedHttpFormat(format) &&
	!hasValue(audioFormat) &&
	!(audioFormatIds?.some((id) => id.trim().length > 0) ?? false) &&
	!hasValue(startTime) &&
	!hasValue(endTime) &&
	(containerFormat === undefined ||
		containerFormat === "auto" ||
		containerFormat === "original") &&
	settingsAllowDirectDelivery(settings);

const isPrivateOrReservedIpv4 = (hostname: string): boolean => {
	const parts = hostname.split(".").map(Number);
	if (
		parts.length !== 4 ||
		parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
	) {
		return false;
	}

	const [first = 0, second = 0, third = 0] = parts;
	return (
		first === 0 ||
		first === 10 ||
		first === 127 ||
		first >= 224 ||
		(first === 100 && second >= 64 && second <= 127) ||
		(first === 169 && second === 254) ||
		(first === 172 && second >= 16 && second <= 31) ||
		(first === 192 && second === 0 && third === 0) ||
		(first === 192 && second === 0 && third === 2) ||
		(first === 192 && second === 168) ||
		(first === 198 && (second === 18 || second === 19)) ||
		(first === 198 && second === 51 && third === 100) ||
		(first === 203 && second === 0 && third === 113)
	);
};

export const isSafeDirectDownloadUrl = (value: string): boolean => {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return false;
	}

	if (
		(url.protocol !== "http:" && url.protocol !== "https:") ||
		url.username ||
		url.password
	) {
		return false;
	}

	const hostname = url.hostname.toLowerCase().replace(/\.+$/u, "");
	if (
		!hostname ||
		hostname === "localhost" ||
		hostname.includes(":") ||
		(!hostname.includes(".") && !isPrivateOrReservedIpv4(hostname)) ||
		SPECIAL_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix)) ||
		isPrivateOrReservedIpv4(hostname)
	) {
		return false;
	}

	return true;
};

const isRejectedContentType = (contentType: string): boolean => {
	const normalized = contentType.toLowerCase();
	return (
		normalized.includes("html") ||
		normalized.includes("json") ||
		normalized.includes("problem") ||
		normalized.includes("error")
	);
};

const hasValidPartialContentRange = (value: string | null): boolean => {
	if (!value) {
		return false;
	}

	const match = /^bytes\s+0-0\/(\d+|\*)$/i.exec(value.trim());
	if (!match) {
		return false;
	}

	const total = match[1];
	return total === "*" || Number(total) >= 1;
};

const hasControlCharacters = (value: string): boolean =>
	Array.from(value).some((character) => {
		const codePoint = character.codePointAt(0) ?? 0;
		return codePoint < 32 || codePoint === 127;
	});

const parseAttachmentFilename = (
	contentDisposition: string,
): string | undefined => {
	const encodedMatch = /filename\*\s*=\s*UTF-8''([^;]+)/iu.exec(
		contentDisposition,
	);
	if (encodedMatch?.[1]) {
		try {
			return sanitizeBrowserFilename(
				decodeURIComponent(encodedMatch[1].trim().replace(/^"|"$/gu, "")),
			);
		} catch {
			throw new Error(
				"Direct download probe returned an invalid attachment filename.",
			);
		}
	}

	const filenameMatch = /filename\s*=\s*(?:"([^"]*)"|([^;]*))/iu.exec(
		contentDisposition,
	);
	const filename = filenameMatch?.[1] ?? filenameMatch?.[2]?.trim();
	return filename ? sanitizeBrowserFilename(filename) : undefined;
};

const validateContentDisposition = (
	contentDisposition: string | null,
): string | undefined => {
	if (
		!contentDisposition ||
		hasControlCharacters(contentDisposition) ||
		!/^attachment(?:\s*;|$)/iu.test(contentDisposition.trim())
	) {
		throw new Error(
			"Direct download probe did not confirm an attachment response.",
		);
	}

	return parseAttachmentFilename(contentDisposition);
};

export const probeDirectDownload = async (
	url: string,
	{
		fetchImpl = globalThis.fetch,
		timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
		pageOrigin = globalThis.location?.origin,
	}: {
		fetchImpl?: typeof fetch;
		timeoutMs?: number;
		pageOrigin?: string;
	} = {},
): Promise<DirectProbeResult> => {
	if (!isSafeDirectDownloadUrl(url)) {
		throw new Error("Direct download URL was rejected.");
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetchImpl(url, {
			credentials: "omit",
			headers: { Range: "bytes=0-0" },
			method: "GET",
			mode: "cors",
			redirect: "error",
			referrerPolicy: "no-referrer",
			signal: controller.signal,
		});

		const cancelPromise = response.body?.cancel();
		if (cancelPromise) {
			await cancelPromise.catch(() => undefined);
		}

		if (
			response.type === "opaque" ||
			response.type === "opaqueredirect" ||
			response.type === "error"
		) {
			throw new Error("Direct download probe returned an opaque response.");
		}
		if (response.status !== 200 && response.status !== 206) {
			throw new Error("Direct download probe returned an invalid status.");
		}
		const contentRange = response.headers.get("content-range");
		if (
			response.status === 206 &&
			contentRange !== null &&
			!hasValidPartialContentRange(contentRange)
		) {
			throw new Error(
				"Direct download probe returned an invalid content range.",
			);
		}

		const contentType = response.headers.get("content-type")?.trim();
		if (contentType && isRejectedContentType(contentType)) {
			throw new Error(
				"Direct download probe returned an invalid content type.",
			);
		}

		const finalUrl = response.url || url;
		if (!isSafeDirectDownloadUrl(finalUrl)) {
			throw new Error("Direct download redirect URL was rejected.");
		}

		const isSameOrigin =
			Boolean(pageOrigin) && new URL(finalUrl).origin === pageOrigin;
		const filename = isSameOrigin
			? undefined
			: validateContentDisposition(response.headers.get("content-disposition"));

		return { finalUrl, contentType: contentType || undefined, filename };
	} finally {
		clearTimeout(timeout);
	}
};

export const sanitizeBrowserFilename = (filename: string): string => {
	let sanitized = "";
	for (const character of filename.normalize("NFC")) {
		const codePoint = character.codePointAt(0) ?? 0;
		if (
			codePoint <= 31 ||
			codePoint === 127 ||
			FORBIDDEN_FILENAME_CHARACTERS.has(character)
		) {
			sanitized += "_";
		} else {
			sanitized += character;
		}
	}

	const trimmed = sanitized.trim().replace(/[. ]+$/u, "");
	return Array.from(trimmed || "download")
		.slice(0, MAX_FILENAME_LENGTH)
		.join("");
};

export const triggerBrowserDownload = (
	url: string,
	filename: string,
	documentRef: Document = globalThis.document,
): void => {
	const anchor = documentRef.createElement("a");
	anchor.href = url;
	anchor.download = sanitizeBrowserFilename(filename);
	anchor.rel = "noopener noreferrer";
	anchor.referrerPolicy = "no-referrer";
	anchor.style.display = "none";
	documentRef.body.append(anchor);
	try {
		anchor.click();
	} finally {
		anchor.remove();
	}
};

export const deliverDirectOrQueue = async (
	input: BrowserDeliveryInput,
	dependencies: DeliveryDependencies = {},
): Promise<BrowserDeliveryResult> => {
	const resolveDelivery =
		dependencies.resolveDelivery ??
		((resolveInput) => orpcClient.downloads.resolveDelivery(resolveInput));
	const createDownload =
		dependencies.createDownload ??
		((fallbackInput) => orpcClient.downloads.create(fallbackInput));

	let serverReason: DeliveryServerReason | undefined;
	try {
		const resolution = await resolveDelivery(input.resolve);
		if (resolution.mode === "server") {
			serverReason = resolution.reason;
		} else {
			const probe = await probeDirectDownload(resolution.url, {
				fetchImpl: dependencies.fetchImpl,
				timeoutMs: dependencies.probeTimeoutMs,
			});
			triggerBrowserDownload(
				probe.finalUrl,
				probe.filename ?? resolution.filename,
				dependencies.documentRef,
			);
			return {
				outcome: "handed-off",
				metadata: {
					filename:
						probe.filename ?? sanitizeBrowserFilename(resolution.filename),
					mime: resolution.mime ?? probe.contentType,
					contentLength: resolution.contentLength,
					expiresAt: resolution.expiresAt,
				},
			};
		}
	} catch {
		serverReason = undefined;
	}

	await createDownload(input.fallback);
	return { outcome: "queued", reason: serverReason };
};
