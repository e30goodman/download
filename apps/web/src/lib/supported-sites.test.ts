import { describe, expect, it } from "vitest";
import {
	HIGHLIGHTED_SITE_KEYS,
	POPULAR_SITE_KEYS,
	POPULAR_SITE_URLS,
} from "./supported-sites";

describe("supported sites links", () => {
	it("provides a homepage url for every popular site", () => {
		for (const siteKey of POPULAR_SITE_KEYS) {
			expect(POPULAR_SITE_URLS[siteKey]).toMatch(/^https:\/\//);
		}
	});

	it("links highlighted badges to known platforms", () => {
		expect(POPULAR_SITE_URLS[HIGHLIGHTED_SITE_KEYS[0]]).toContain("youtube.com");
		expect(POPULAR_SITE_URLS[HIGHLIGHTED_SITE_KEYS[1]]).toContain("tiktok.com");
		expect(POPULAR_SITE_URLS[HIGHLIGHTED_SITE_KEYS[2]]).toContain(
			"instagram.com",
		);
	});
});
