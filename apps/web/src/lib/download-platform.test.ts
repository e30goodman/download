import { describe, expect, it } from "vitest";
import { resolvePlatformLabel } from "./download-platform";

describe("resolvePlatformLabel", () => {
	it("prefers channel extractor names", () => {
		expect(
			resolvePlatformLabel({
				channel: "Twitter",
				url: "https://www.youtube.com/watch?v=abc",
			}),
		).toBe("Twitter");
	});

	it("falls back to url hostnames", () => {
		expect(
			resolvePlatformLabel({
				url: "https://www.instagram.com/reel/abc/",
			}),
		).toBe("Instagram");
		expect(
			resolvePlatformLabel({
				url: "https://x.com/user/status/1",
			}),
		).toBe("Twitter");
	});
});
