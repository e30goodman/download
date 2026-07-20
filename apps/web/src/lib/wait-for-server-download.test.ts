import { describe, expect, it, vi } from "vitest";
import { waitForServerDownload } from "./wait-for-server-download";

vi.mock("./orpc-client", () => ({
	orpcClient: {
		downloads: {
			list: vi.fn(),
		},
		history: {
			list: vi.fn(),
		},
	},
}));

import { orpcClient } from "./orpc-client";

describe("waitForServerDownload", () => {
	it("resolves when the task reaches completed in history", async () => {
		vi.mocked(orpcClient.downloads.list)
			.mockResolvedValueOnce({ downloads: [{ id: "d1", status: "downloading" }] as never })
			.mockResolvedValueOnce({ downloads: [] });
		vi.mocked(orpcClient.history.list)
			.mockResolvedValueOnce({ history: [] })
			.mockResolvedValueOnce({
				history: [{ id: "d1", status: "completed" }] as never,
			});

		await expect(
			waitForServerDownload("d1", { intervalMs: 1, timeoutMs: 1000 }),
		).resolves.toBe("completed");
	});

	it("returns error for failed tasks", async () => {
		vi.mocked(orpcClient.downloads.list).mockResolvedValue({ downloads: [] });
		vi.mocked(orpcClient.history.list).mockResolvedValue({
			history: [{ id: "d2", status: "error" }] as never,
		});

		await expect(
			waitForServerDownload("d2", { intervalMs: 1, timeoutMs: 1000 }),
		).resolves.toBe("error");
	});
});
