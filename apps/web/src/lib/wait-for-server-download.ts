import type { DownloadTask } from "@vidbee/downloader-core";
import { sleep } from "./api-endpoint";
import { orpcClient } from "./orpc-client";

export type WaitForDownloadResult =
	| "completed"
	| "error"
	| "cancelled"
	| "timeout";

const TERMINAL_STATUSES = new Set(["completed", "error", "cancelled"]);

const findTask = (
	downloadId: string,
	active: DownloadTask[],
	history: DownloadTask[],
): DownloadTask | undefined =>
	active.find((task) => task.id === downloadId) ??
	history.find((task) => task.id === downloadId);

export const waitForServerDownload = async (
	downloadId: string,
	options: {
		timeoutMs?: number;
		intervalMs?: number;
		onTick?: (task: DownloadTask | undefined) => void;
	} = {},
): Promise<WaitForDownloadResult> => {
	const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
	const intervalMs = options.intervalMs ?? 1000;
	const startedAt = Date.now();

	while (Date.now() - startedAt < timeoutMs) {
		const [downloadsResult, historyResult] = await Promise.all([
			orpcClient.downloads.list(),
			orpcClient.history.list(),
		]);
		const task = findTask(
			downloadId,
			downloadsResult.downloads,
			historyResult.history,
		);
		options.onTick?.(task);

		if (task && TERMINAL_STATUSES.has(task.status)) {
			if (task.status === "completed") {
				return "completed";
			}
			if (task.status === "cancelled") {
				return "cancelled";
			}
			return "error";
		}

		await sleep(intervalMs);
	}

	return "timeout";
};
