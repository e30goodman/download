import { describe, expect, it } from "vitest";
import {
	buildShareDownloadUrl,
	buildShareDownloadUrlFromRecord,
	parseShareDownloadParams,
} from "./share-download-link";

describe("share download link", () => {
	it("builds a share URL with url, type, and format", () => {
		const shareUrl = buildShareDownloadUrl({
			url: "https://www.youtube.com/shorts/abc",
			type: "video",
			formatId: "137",
		});

		expect(shareUrl).toContain("url=");
		expect(shareUrl).toContain("type=video");
		expect(shareUrl).toContain("format=137");
	});

	it("parses share params from search string", () => {
		const parsed = parseShareDownloadParams(
			"?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dabc&type=video&format=137",
		);

		expect(parsed).toEqual({
			url: "https://www.youtube.com/watch?v=abc",
			type: "video",
			formatId: "137",
		});
	});

	it("builds share URL from download record metadata", () => {
		const shareUrl = buildShareDownloadUrlFromRecord({
			id: "task-1",
			entryType: "history",
			url: "https://www.youtube.com/watch?v=abc",
			type: "video",
			status: "completed",
			selectedFormat: {
				formatId: "137",
				ext: "mp4",
				height: 1080,
			},
		});

		expect(shareUrl).toContain("format=137");
		expect(shareUrl).toContain("type=video");
	});
});
