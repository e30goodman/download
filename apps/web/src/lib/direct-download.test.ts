// @vitest-environment jsdom

import type {
	CreateDownloadInput,
	ResolveDeliveryInput,
	VideoFormat,
} from "@vidbee/downloader-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	deliverDirectOrQueue,
	isDirectDownloadEligible,
	isSafeDirectDownloadUrl,
	probeDirectDownload,
} from "./direct-download";

const sourceUrl = "https://videos.example/watch/123";
const mediaUrl = "https://cdn.example.com/media/video.mp4?token=secret";
const directSettings = {
	browserForCookies: "none",
	embedChapters: false,
	embedMetadata: false,
	embedSubs: false,
	embedThumbnail: false,
};

const resolveInput: ResolveDeliveryInput = {
	formatId: "muxed-720",
	settings: directSettings,
	type: "video",
	url: sourceUrl,
};

const fallbackInput: CreateDownloadInput = {
	format: "muxed-720",
	selectedFormat: {
		acodec: "mp4a",
		ext: "mp4",
		formatId: "muxed-720",
		protocol: "https",
		vcodec: "avc1",
	},
	settings: directSettings,
	title: "Example video",
	type: "video",
	url: sourceUrl,
};

const createResponse = ({
	contentDisposition = "attachment",
	contentRange = "bytes 0-0/100",
	contentType = "video/mp4",
	status = 206,
	url = mediaUrl,
}: {
	contentDisposition?: string | null;
	contentRange?: string | null;
	contentType?: string;
	status?: number;
	url?: string;
} = {}) => {
	const cancel = vi.fn().mockResolvedValue(undefined);
	const headers = new Headers({ "content-type": contentType });
	if (contentDisposition) {
		headers.set("content-disposition", contentDisposition);
	}
	if (contentRange) {
		headers.set("content-range", contentRange);
	}
	const response = {
		body: { cancel },
		headers,
		status,
		type: "cors",
		url,
	} as unknown as Response;
	return { cancel, response };
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe("isDirectDownloadEligible", () => {
	const muxedHttpFormat: VideoFormat = {
		acodec: "mp4a",
		ext: "mp4",
		formatId: "18",
		protocol: "https",
		vcodec: "avc1",
	};

	it("allows only public muxed HTTP video formats", () => {
		expect(
			isDirectDownloadEligible({
				format: muxedHttpFormat,
				isPublicSite: true,
				settings: directSettings,
				type: "video",
			}),
		).toBe(true);
		expect(
			isDirectDownloadEligible({
				format: muxedHttpFormat,
				isPublicSite: false,
				settings: directSettings,
				type: "video",
			}),
		).toBe(false);
		expect(
			isDirectDownloadEligible({
				format: muxedHttpFormat,
				isPublicSite: true,
				settings: directSettings,
				type: "audio",
			}),
		).toBe(false);
	});

	it("rejects streams and formats requiring a merge", () => {
		expect(
			isDirectDownloadEligible({
				format: { ...muxedHttpFormat, protocol: "m3u8_native" },
				isPublicSite: true,
				settings: directSettings,
				type: "video",
			}),
		).toBe(false);
		expect(
			isDirectDownloadEligible({
				format: { ...muxedHttpFormat, acodec: "none" },
				isPublicSite: true,
				settings: directSettings,
				type: "video",
			}),
		).toBe(false);
	});

	it("rejects default processing settings and non-empty credentials", () => {
		expect(
			isDirectDownloadEligible({
				format: muxedHttpFormat,
				isPublicSite: true,
				settings: {},
				type: "video",
			}),
		).toBe(false);
		expect(
			isDirectDownloadEligible({
				format: muxedHttpFormat,
				isPublicSite: true,
				settings: { ...directSettings, proxy: " https://proxy.example " },
				type: "video",
			}),
		).toBe(false);
		expect(
			isDirectDownloadEligible({
				containerFormat: "mkv",
				format: muxedHttpFormat,
				isPublicSite: true,
				settings: directSettings,
				type: "video",
			}),
		).toBe(false);
	});
});

describe("isSafeDirectDownloadUrl", () => {
	it.each([
		"http://localhost./video.mp4",
		"http://2130706433/video.mp4",
		"http://0x7f000001/video.mp4",
		"http://0177.0.0.1/video.mp4",
		"http://[::ffff:127.0.0.1]/video.mp4",
		"http://[::127.0.0.1]/video.mp4",
		"http://[fc00::1]/video.mp4",
		"http://[fe80::1]/video.mp4",
	])("rejects special and private host form %s", (url) => {
		expect(isSafeDirectDownloadUrl(url)).toBe(false);
	});
});

describe("probeDirectDownload", () => {
	it("uses a one-byte CORS GET and cancels the response body", async () => {
		const { cancel, response } = createResponse();
		const fetchImpl = vi.fn().mockResolvedValue(response);

		await expect(probeDirectDownload(mediaUrl, { fetchImpl })).resolves.toEqual(
			{
				contentType: "video/mp4",
				finalUrl: mediaUrl,
				filename: undefined,
			},
		);
		expect(fetchImpl).toHaveBeenCalledWith(
			mediaUrl,
			expect.objectContaining({
				credentials: "omit",
				headers: { Range: "bytes=0-0" },
				method: "GET",
				mode: "cors",
				redirect: "error",
				referrerPolicy: "no-referrer",
			}),
		);
		expect(cancel).toHaveBeenCalledOnce();
	});

	it("accepts 206 when Content-Range is not exposed", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(createResponse({ contentRange: null }).response);

		await expect(
			probeDirectDownload(mediaUrl, { fetchImpl }),
		).resolves.toMatchObject({ finalUrl: mediaUrl });
	});

	it("rejects error payloads and invalid partial ranges", async () => {
		const htmlFetch = vi
			.fn()
			.mockResolvedValue(createResponse({ contentType: "text/html" }).response);
		await expect(
			probeDirectDownload(mediaUrl, { fetchImpl: htmlFetch }),
		).rejects.toThrow("invalid content type");

		const invalidRangeFetch = vi
			.fn()
			.mockResolvedValue(
				createResponse({ contentRange: "bytes 1-1/100" }).response,
			);
		await expect(
			probeDirectDownload(mediaUrl, { fetchImpl: invalidRangeFetch }),
		).rejects.toThrow("invalid content range");
	});

	it("rejects private redirect targets", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(
				createResponse({ url: "http://127.0.0.1/video.mp4" }).response,
			);
		await expect(probeDirectDownload(mediaUrl, { fetchImpl })).rejects.toThrow(
			"redirect URL was rejected",
		);
	});

	it("requires attachment cross-origin and accepts a same-origin response", async () => {
		const withoutAttachment = createResponse({
			contentDisposition: null,
		}).response;
		await expect(
			probeDirectDownload(mediaUrl, {
				fetchImpl: vi.fn().mockResolvedValue(withoutAttachment),
			}),
		).rejects.toThrow("attachment response");

		await expect(
			probeDirectDownload(mediaUrl, {
				fetchImpl: vi.fn().mockResolvedValue(withoutAttachment),
				pageOrigin: new URL(mediaUrl).origin,
			}),
		).resolves.toMatchObject({ finalUrl: mediaUrl });
	});

	it("sanitizes an exposed attachment filename", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			createResponse({
				contentDisposition:
					"attachment; filename*=UTF-8''Browser%3A%20video.mp4",
			}).response,
		);

		await expect(
			probeDirectDownload(mediaUrl, { fetchImpl }),
		).resolves.toMatchObject({ filename: "Browser_ video.mp4" });
	});
});

describe("deliverDirectOrQueue", () => {
	it("hands a successful direct delivery to the browser without queueing", async () => {
		const { response } = createResponse();
		let clickedAnchor: HTMLAnchorElement | undefined;
		const click = vi
			.spyOn(HTMLAnchorElement.prototype, "click")
			.mockImplementation(function captureAnchor(this: HTMLAnchorElement) {
				clickedAnchor = this;
			});
		const createDownload = vi.fn();

		const result = await deliverDirectOrQueue(
			{ fallback: fallbackInput, resolve: resolveInput },
			{
				createDownload,
				fetchImpl: vi.fn().mockResolvedValue(response),
				resolveDelivery: vi.fn().mockResolvedValue({
					contentLength: 100,
					filename: 'Example: "video".mp4',
					mime: "video/mp4",
					mode: "direct",
					url: mediaUrl,
				}),
			},
		);

		expect(result).toEqual({
			metadata: {
				contentLength: 100,
				expiresAt: undefined,
				filename: "Example_ _video_.mp4",
				mime: "video/mp4",
			},
			outcome: "handed-off",
		});
		expect(createDownload).not.toHaveBeenCalled();
		expect(click).toHaveBeenCalledOnce();
		expect(clickedAnchor?.target).toBe("");
		expect(clickedAnchor?.rel).toBe("noopener noreferrer");
		expect(clickedAnchor?.referrerPolicy).toBe("no-referrer");
	});

	it("queues the original input once when the resolver selects server mode", async () => {
		const createDownload = vi.fn().mockResolvedValue({ id: "queued" });

		await expect(
			deliverDirectOrQueue(
				{ fallback: fallbackInput, resolve: resolveInput },
				{
					createDownload,
					resolveDelivery: vi.fn().mockResolvedValue({
						mode: "server",
						reason: "processing-required",
					}),
				},
			),
		).resolves.toEqual({
			outcome: "queued",
			reason: "processing-required",
		});
		expect(createDownload).toHaveBeenCalledOnce();
		expect(createDownload).toHaveBeenCalledWith(fallbackInput);
	});

	it("queues once after a probe failure and propagates fallback failure", async () => {
		const fallbackError = new Error("Queue unavailable");
		const createDownload = vi.fn().mockRejectedValue(fallbackError);

		await expect(
			deliverDirectOrQueue(
				{ fallback: fallbackInput, resolve: resolveInput },
				{
					createDownload,
					fetchImpl: vi
						.fn()
						.mockResolvedValue(
							createResponse({ contentType: "application/json" }).response,
						),
					resolveDelivery: vi.fn().mockResolvedValue({
						filename: "video.mp4",
						mode: "direct",
						url: mediaUrl,
					}),
				},
			),
		).rejects.toBe(fallbackError);
		expect(createDownload).toHaveBeenCalledOnce();
		expect(createDownload).toHaveBeenCalledWith(fallbackInput);
	});
});
