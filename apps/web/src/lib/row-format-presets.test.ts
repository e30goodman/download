import { describe, expect, it } from "vitest";
import {
	buildFormatSelectorFromPreset,
	buildSelectedFormatForRowPreset,
	getDefaultRowPresetForType,
	getRowFormatOptions,
	getRowVideoContainerOptions,
	inferRowFormatPreset,
	inferVideoContainerFromDownload,
} from "./row-format-presets";

describe("row format presets", () => {
	it("returns only the allowed preset options per type", () => {
		expect(getRowFormatOptions("video").map((option) => option.preset)).toEqual([
			"original",
			"1080",
			"720",
			"360",
		]);
		expect(getRowFormatOptions("audio").map((option) => option.preset)).toEqual([
			"mp3",
			"wav",
		]);
		expect(getRowFormatOptions("text").map((option) => option.preset)).toEqual([
			"txt",
			"md",
		]);
		expect(
			getRowVideoContainerOptions().map((option) => option.container),
		).toEqual(["mp4", "mkv", "webm"]);
	});

	it("builds format selectors from presets", () => {
		expect(
			buildFormatSelectorFromPreset({ type: "video", preset: "720" }).format,
		).toContain("height<=720");
		expect(
			buildFormatSelectorFromPreset({ type: "audio", preset: "wav" }).audioFormat,
		).toBe("wav");
		expect(
			buildFormatSelectorFromPreset({ type: "text", preset: "md" }).audioFormat,
		).toBe("md");
	});

	it("infers presets from completed download metadata", () => {
		expect(
			inferRowFormatPreset({
				id: "1",
				entryType: "history",
				url: "https://youtube.com/watch?v=abc",
				type: "video",
				status: "completed",
				selectedFormat: { formatId: "137", ext: "mp4", height: 1080 },
			}),
		).toBe("1080");
		expect(
			inferVideoContainerFromDownload({
				id: "1",
				entryType: "history",
				url: "https://youtube.com/watch?v=abc",
				type: "video",
				status: "completed",
				selectedFormat: { formatId: "137", ext: "mkv", height: 720 },
			}),
		).toBe("mkv");
	});

	it("returns default preset per download type", () => {
		expect(getDefaultRowPresetForType("video")).toBe("original");
		expect(getDefaultRowPresetForType("audio")).toBe("mp3");
		expect(getDefaultRowPresetForType("text")).toBe("txt");
	});

	it("builds selected format metadata for browser row updates", () => {
		expect(
			buildSelectedFormatForRowPreset({
				type: "video",
				preset: "720",
				container: "webm",
			}),
		).toMatchObject({
			ext: "webm",
			height: 720,
			formatNote: "720p",
		});
		expect(
			buildSelectedFormatForRowPreset({
				type: "audio",
				preset: "wav",
			}),
		).toMatchObject({
			ext: "wav",
		});
	});
});
