import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureResolvedApiUrl } from "./api-endpoint";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("ensureResolvedApiUrl", () => {
	it("selects the newest healthy endpoint instead of the first response", async () => {
		vi.stubGlobal("window", {
			location: {
				href: "https://example.com/download/",
				origin: "https://example.com",
			},
		});

		const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
			const url = input.toString();
			if (url.endsWith("/health")) {
				const ok = url.startsWith("https://current.trycloudflare.com");
				return new Response(JSON.stringify({ ok }), { status: 200 });
			}

			const isRawEndpoint = url.includes("raw.githubusercontent.com");
			return new Response(
				JSON.stringify({
					url: isRawEndpoint
						? "https://current.trycloudflare.com"
						: "https://stale.trycloudflare.com",
					updatedAt: isRawEndpoint
						? "2026-07-21T16:03:30.000Z"
						: "2026-07-20T17:07:48.000Z",
				}),
				{ status: 200 },
			);
		}) as typeof fetch;

		await expect(
			ensureResolvedApiUrl("https://fallback.example.com", {
				fetchImpl,
				force: true,
			}),
		).resolves.toBe("https://current.trycloudflare.com");
	});

	it("falls back to an older candidate when the newest host fails health", async () => {
		vi.stubGlobal("window", {
			location: {
				href: "https://example.com/download/",
				origin: "https://example.com",
			},
		});

		const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
			const url = input.toString();
			if (url.endsWith("/health")) {
				const ok = url.startsWith("https://stale.trycloudflare.com");
				return new Response(JSON.stringify({ ok }), {
					status: ok ? 200 : 503,
				});
			}

			const isRawEndpoint = url.includes("raw.githubusercontent.com");
			return new Response(
				JSON.stringify({
					url: isRawEndpoint
						? "https://current.trycloudflare.com"
						: "https://stale.trycloudflare.com",
					updatedAt: isRawEndpoint
						? "2026-07-21T16:03:30.000Z"
						: "2026-07-20T17:07:48.000Z",
				}),
				{ status: 200 },
			);
		}) as typeof fetch;

		await expect(
			ensureResolvedApiUrl("https://fallback.example.com", {
				fetchImpl,
				force: true,
			}),
		).resolves.toBe("https://stale.trycloudflare.com");
	});
});
