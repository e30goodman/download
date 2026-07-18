import type {
	DownloadTask,
	DownloadType,
	VideoFormat,
} from "@vidbee/downloader-core";

export type ServerDownloadRecord = DownloadTask & {
	deliveryMode?: "server";
	entryType: "active" | "history";
};

type BrowserSafeDownloadKeys =
	| "createdAt"
	| "id"
	| "savedFileName"
	| "selectedFormat"
	| "thumbnail"
	| "title"
	| "type"
	| "url";

type BrowserServerOnlyFields = Partial<
	Record<Exclude<keyof DownloadTask, BrowserSafeDownloadKeys | "status">, never>
>;

export type BrowserDownloadRecord = {
	createdAt: number;
	deliveryMode: "browser";
	entryType: "browser";
	handedOffAt: number;
	id: string;
	savedFileName?: string;
	selectedFormat?: VideoFormat;
	status: "handed-off";
	thumbnail?: string;
	title?: string;
	type: DownloadType;
	url: string;
} & BrowserServerOnlyFields;

export type BrowserHandedOffRecord = BrowserDownloadRecord;

export type DownloadRecord = ServerDownloadRecord | BrowserDownloadRecord;

export type StatusFilter = "all" | "active" | "completed" | "error";
