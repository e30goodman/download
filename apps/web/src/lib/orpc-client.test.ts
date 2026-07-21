import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./api-endpoint", () => ({
	ensureResolvedApiUrl: vi.fn(async (fallbackUrl: string) => fallbackUrl),
	getCachedApiUrl: vi.fn((fallbackUrl: string) => fallbackUrl),
	sleep: vi.fn(async () => undefined),
}));

import { rpcFetch } from "./orpc-client";

describe("rpcFetch", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("creates an independent request body for every retry", async () => {
		const receivedBodies: string[] = [];
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockImplementationOnce(async (request) => {
				receivedBodies.push(await request.text());
				throw new TypeError("Failed to fetch");
			})
			.mockImplementationOnce(async (request) => {
				receivedBodies.push(await request.text());
				return new Response("ok");
			});
		vi.stubGlobal("fetch", fetchMock);

		const response = await rpcFetch(
			new Request("http://localhost:3000/rpc/downloads/create", {
				body: JSON.stringify({ url: "https://example.com/video" }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
			{ redirect: "manual" },
		);

		expect(await response.text()).toBe("ok");
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(receivedBodies).toEqual([
			'{"url":"https://example.com/video"}',
			'{"url":"https://example.com/video"}',
		]);
	});

	it("does not retry an aborted request", async () => {
		const controller = new AbortController();
		const fetchMock = vi.fn<typeof fetch>();
		vi.stubGlobal("fetch", fetchMock);
		controller.abort(new DOMException("Cancelled", "AbortError"));

		await expect(
			rpcFetch(
				new Request("http://localhost:3000/rpc/downloads/create", {
					body: "{}",
					method: "POST",
					signal: controller.signal,
				}),
				{ redirect: "manual" },
			),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
