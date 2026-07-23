import { describe, expect, it } from "vitest";
import type {
	BrowserDownloadRecord,
	ServerDownloadRecord,
} from "../components/download/types";
import {
	addBrowserDownloadRecord,
	createBrowserHandedOffRecord,
	DIRECT_DOWNLOAD_HISTORY_MAX_ENTRIES,
	DIRECT_DOWNLOAD_HISTORY_STORAGE_KEY,
	mergeDownloadRecords,
	partitionDownloadRecordIds,
	readBrowserDownloadHistory,
	removeBrowserDownloadRecords,
	removeBrowserRecordsFromList,
	sanitizeOriginalPageUrl,
} from "./direct-download-history";

class MemoryStorage {
	private readonly values = new Map<string, string>();

	getItem(key: string): string | null {
		return this.values.get(key) ?? null;
	}

	setItem(key: string, value: string): void {
		this.values.set(key, value);
	}
}

class FailingWriteStorage {
	constructor(private readonly raw: string) {}

	getItem(): string {
		return this.raw;
	}

	setItem(): void {
		throw new Error("Storage unavailable");
	}
}

const makeBrowserId = (value: number): string =>
	`browser:00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;

const browserRecord = (
	id: string,
	handedOffAt: number,
): BrowserDownloadRecord => ({
	id,
	url: `https://videos.example.com/watch/${encodeURIComponent(id)}`,
	title: id,
	type: "video",
	status: "handed-off",
	entryType: "browser",
	deliveryMode: "browser",
	createdAt: handedOffAt,
	handedOffAt,
});

describe("direct download history storage", () => {
	it("gracefully ignores malformed and invalid records", () => {
		const storage = new MemoryStorage();
		storage.setItem(DIRECT_DOWNLOAD_HISTORY_STORAGE_KEY, "{broken");
		expect(readBrowserDownloadHistory(storage)).toEqual([]);

		storage.setItem(
			DIRECT_DOWNLOAD_HISTORY_STORAGE_KEY,
			JSON.stringify({
				version: 1,
				records: [
					{ status: "completed", url: "https://cdn.example/video.mp4" },
					browserRecord(makeBrowserId(1), 10),
				],
			}),
		);
		expect(readBrowserDownloadHistory(storage)).toEqual([
			browserRecord(makeBrowserId(1), 10),
		]);
	});

	it("sanitizes sensitive query parameters case-insensitively", () => {
		expect(
			sanitizeOriginalPageUrl(
				"https://videos.example.com/watch/1?list=public&TOKEN=secret&X-Amz-Signature=signed&sig=value&expires=10#chapter",
			),
		).toBe("https://videos.example.com/watch/1?list=public#chapter");
		expect(
			sanitizeOriginalPageUrl("http://localhost/watch?token=x"),
		).toBeUndefined();
	});

	it.each([
		"http://localhost./watch",
		"http://intranet/watch",
		"http://host.local/watch",
		"http://host.lan/watch",
		"http://host.test/watch",
		"http://host.invalid/watch",
		"http://host.example/watch",
		"http://host.onion/watch",
		"http://host.home/watch",
		"http://host.internal/watch",
		"http://127.0.0.1/watch",
		"http://10.0.0.1/watch",
		"http://169.254.1.1/watch",
		"http://172.16.0.1/watch",
		"http://192.168.0.1/watch",
		"http://192.0.2.1/watch",
		"http://2130706433/watch",
		"http://0x7f000001/watch",
		"http://0177.0.0.1/watch",
		"http://[::1]/watch",
		"http://[fc00::1]/watch",
		"http://[fe80::1]/watch",
		"http://[::ffff:127.0.0.1]/watch",
	])("rejects non-public original page host %s", (url) => {
		expect(sanitizeOriginalPageUrl(url)).toBeUndefined();
	});

	it("keeps a public DNS hostname usable", () => {
		expect(
			sanitizeOriginalPageUrl(
				"https://www.example.com/watch/1?list=public&token=secret",
			),
		).toBe("https://www.example.com/watch/1?list=public");
	});

	it("stores only allowlisted metadata and bounds history", () => {
		const storage = new MemoryStorage();
		const directUrl =
			"https://cdn.example/video.mp4?token=secret&expires=tomorrow";
		const thumbnailUrl =
			"https://scontent.cdninstagram.com/v/t51/thumb.jpg?stp=dst-jpg&ig_cache_key=abc&oh=cdn-sig&oe=expiry";

		for (
			let index = 0;
			index < DIRECT_DOWNLOAD_HISTORY_MAX_ENTRIES + 5;
			index += 1
		) {
			const unsafeInput = {
				filename: `video-${index}.mp4`,
				handedOffAt: index,
				id: makeBrowserId(index),
				url: `https://videos.example.com/watch/${index}?list=ok&token=page-secret`,
				title: `Video ${index}`,
				thumbnail: thumbnailUrl,
				type: "video" as const,
				selectedFormat: {
					acodec: "mp4a",
					ext: "mp4",
					formatId: "18",
					protocol: "https",
					vcodec: "avc1",
				},
				directUrl,
				headers: { Authorization: "secret" },
			};
			addBrowserDownloadRecord(
				createBrowserHandedOffRecord(unsafeInput),
				storage,
			);
		}

		const records = readBrowserDownloadHistory(storage);
		expect(records).toHaveLength(DIRECT_DOWNLOAD_HISTORY_MAX_ENTRIES);
		expect(records[0]?.id).toBe(makeBrowserId(104));
		expect(records[0]?.url).toBe(
			"https://videos.example.com/watch/104?list=ok",
		);
		expect(records[0]?.thumbnail).toBe(thumbnailUrl);
		const raw = storage.getItem(DIRECT_DOWNLOAD_HISTORY_STORAGE_KEY) ?? "";
		expect(raw).not.toContain(directUrl);
		expect(raw).not.toContain("Authorization");
		expect(raw).not.toContain("page-secret");
		expect(raw).toContain("ig_cache_key");
	});

	it("keeps Instagram CDN thumbnails with signed query params", () => {
		const storage = new MemoryStorage();
		const thumbnail =
			"https://scontent-zrh1-1.cdninstagram.com/v/t51.82787-15/thumb.jpg?stp=dst-jpg_e15_tt6&ig_cache_key=abc.3-ccb7-5&oh=00_AQD&oe=6A6859A0";
		addBrowserDownloadRecord(
			createBrowserHandedOffRecord({
				filename: "video.mp4",
				id: makeBrowserId(1),
				thumbnail,
				title: "Video by creator",
				type: "video",
				url: "https://www.instagram.com/p/Da8B-sGzz7W/",
			}),
			storage,
		);

		expect(readBrowserDownloadHistory(storage)[0]?.thumbnail).toBe(thumbnail);
	});

	it("removes only requested browser records", () => {
		const storage = new MemoryStorage();
		const ids = [makeBrowserId(1), makeBrowserId(2)];
		for (const id of ids) {
			addBrowserDownloadRecord(
				createBrowserHandedOffRecord({
					filename: "video.mp4",
					id,
					type: "video",
					url: `https://videos.example.com/watch/${encodeURIComponent(id)}`,
				}),
				storage,
			);
		}

		expect(removeBrowserDownloadRecords([ids[0] ?? ""], storage)).toEqual({
			success: true,
			removedIds: [ids[0]],
		});
		expect(
			readBrowserDownloadHistory(storage).map((record) => record.id),
		).toEqual([ids[1]]);
	});

	it("reports write failure without claiming removal", () => {
		const storage = new MemoryStorage();
		const id = makeBrowserId(3);
		addBrowserDownloadRecord(browserRecord(id, 3), storage);
		const failingStorage = new FailingWriteStorage(
			storage.getItem(DIRECT_DOWNLOAD_HISTORY_STORAGE_KEY) ?? "",
		);

		expect(removeBrowserDownloadRecords([id], failingStorage)).toEqual({
			success: false,
			removedIds: [],
		});
	});
});

describe("download record merge and removal", () => {
	it("merges stably and removes browser-only records from a list", () => {
		const serverRecord: ServerDownloadRecord = {
			id: "server",
			url: "https://videos.example.com/watch/server",
			type: "video",
			status: "completed",
			entryType: "history",
			createdAt: 20,
			completedAt: 30,
		};
		const localRecord = browserRecord(makeBrowserId(4), 30);

		const merged = mergeDownloadRecords([serverRecord], [localRecord]);
		expect(merged.map((record) => record.id)).toEqual([
			"server",
			makeBrowserId(4),
		]);
		expect(
			removeBrowserRecordsFromList(merged, [makeBrowserId(4)]).map(
				(record) => record.id,
			),
		).toEqual(["server"]);
	});

	it("rejects colliding local IDs and partitions browser-only and mixed deletes", () => {
		const storage = new MemoryStorage();
		storage.setItem(
			DIRECT_DOWNLOAD_HISTORY_STORAGE_KEY,
			JSON.stringify({
				version: 1,
				records: [browserRecord("server", 40)],
			}),
		);
		expect(readBrowserDownloadHistory(storage)).toEqual([]);

		const collidingId = makeBrowserId(6);
		const serverRecord: ServerDownloadRecord = {
			id: collidingId,
			url: "https://videos.example.com/watch/server",
			type: "video",
			status: "completed",
			entryType: "history",
			createdAt: 20,
		};
		const collidingLocalRecord = browserRecord(collidingId, 40);
		expect(
			mergeDownloadRecords([serverRecord], [collidingLocalRecord]),
		).toEqual([serverRecord]);

		const localRecord = browserRecord(makeBrowserId(5), 30);
		const records = mergeDownloadRecords([serverRecord], [localRecord]);
		expect(partitionDownloadRecordIds(records, [makeBrowserId(5)])).toEqual({
			browserIds: [makeBrowserId(5)],
			serverIds: [],
		});
		expect(
			partitionDownloadRecordIds(records, [collidingId, makeBrowserId(5)]),
		).toEqual({
			browserIds: [makeBrowserId(5)],
			serverIds: [collidingId],
		});
	});
});
