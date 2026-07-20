import type { DownloadType, VideoFormat } from "@vidbee/downloader-core";
import type {
	BrowserDownloadRecord,
	DownloadRecord,
	ServerDownloadRecord,
} from "../components/download/types";
import { isSafeDirectDownloadUrl } from "./direct-download";

export const DIRECT_DOWNLOAD_HISTORY_STORAGE_KEY =
	"vidbee.direct-download-history.v1";
export const DIRECT_DOWNLOAD_HISTORY_MAX_ENTRIES = 100;

interface StorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

interface CreateBrowserRecordInput {
	filename: string;
	handedOffAt?: number;
	id?: string;
	selectedFormat?: VideoFormat;
	thumbnail?: string;
	title?: string;
	type: DownloadType;
	url: string;
}

export type BrowserHistoryRemovalResult =
	| { success: true; removedIds: string[] }
	| { success: false; removedIds: [] };

const BROWSER_RECORD_ID_PATTERN =
	/^browser:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SENSITIVE_QUERY_KEY =
	/(?:^|[_-])(?:access-token|acl|auth|authorization|credential|expires?|googleaccessid|awsaccesskeyid|hdnea|hdnts|hmac|jwt|key|key-pair-id|policy|se|sig|signature|signed|sp|sr|sv|token|x-amz|x-goog)(?:$|[_-])/iu;
const STRING_FORMAT_FIELDS = [
	"formatId",
	"ext",
	"vcodec",
	"acodec",
	"formatNote",
	"protocol",
	"language",
	"videoExt",
	"audioExt",
] as const satisfies ReadonlyArray<keyof VideoFormat>;
const NUMBER_FORMAT_FIELDS = [
	"width",
	"height",
	"fps",
	"filesize",
	"filesizeApprox",
	"tbr",
	"quality",
] as const satisfies ReadonlyArray<keyof VideoFormat>;

const getStorage = (): StorageLike | undefined => {
	try {
		return globalThis.localStorage;
	} catch {
		return undefined;
	}
};

const isFiniteNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

const isPublicHttpUrl = (
	value: unknown,
	options: { rejectSensitiveQuery?: boolean } = {},
): value is string => {
	if (typeof value !== "string" || value.length > 4096) {
		return false;
	}
	if (!isSafeDirectDownloadUrl(value)) {
		return false;
	}
	if (options.rejectSensitiveQuery) {
		const parsed = new URL(value);
		for (const key of parsed.searchParams.keys()) {
			if (SENSITIVE_QUERY_KEY.test(key)) {
				return false;
			}
		}
	}
	return true;
};

export const sanitizeOriginalPageUrl = (value: unknown): string | undefined => {
	if (!isPublicHttpUrl(value)) {
		return undefined;
	}
	const sanitized = new URL(value);
	for (const key of Array.from(sanitized.searchParams.keys())) {
		if (SENSITIVE_QUERY_KEY.test(key)) {
			sanitized.searchParams.delete(key);
		}
	}
	const result = sanitized.toString();
	return result.length <= 4096
		? result
		: `${sanitized.origin}${sanitized.pathname}`;
};

const parseSelectedFormat = (value: unknown): VideoFormat | undefined => {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const source = value as Record<string, unknown>;
	if (typeof source.formatId !== "string" || typeof source.ext !== "string") {
		return undefined;
	}
	const format: VideoFormat = {
		formatId: source.formatId.slice(0, 128),
		ext: source.ext.slice(0, 32),
	};
	for (const field of STRING_FORMAT_FIELDS) {
		const fieldValue = source[field];
		if (typeof fieldValue === "string") {
			Object.assign(format, { [field]: fieldValue.slice(0, 256) });
		}
	}
	for (const field of NUMBER_FORMAT_FIELDS) {
		const fieldValue = source[field];
		if (isFiniteNumber(fieldValue) && fieldValue >= 0) {
			Object.assign(format, { [field]: fieldValue });
		}
	}
	return format;
};

const parseBrowserRecord = (
	value: unknown,
): BrowserDownloadRecord | undefined => {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const source = value as Record<string, unknown>;
	const sanitizedUrl = sanitizeOriginalPageUrl(source.url);
	if (
		typeof source.id !== "string" ||
		!BROWSER_RECORD_ID_PATTERN.test(source.id) ||
		!sanitizedUrl ||
		!(source.type === "video" || source.type === "audio" || source.type === "text") ||
		source.status !== "handed-off" ||
		source.entryType !== "browser" ||
		source.deliveryMode !== "browser" ||
		!isFiniteNumber(source.createdAt) ||
		!isFiniteNumber(source.handedOffAt)
	) {
		return undefined;
	}
	const record: BrowserDownloadRecord = {
		createdAt: source.createdAt,
		deliveryMode: "browser",
		entryType: "browser",
		handedOffAt: source.handedOffAt,
		id: source.id.slice(0, 128),
		status: "handed-off",
		type: source.type,
		url: sanitizedUrl,
	};
	if (typeof source.title === "string") {
		record.title = source.title.slice(0, 1000);
	}
	if (isPublicHttpUrl(source.thumbnail, { rejectSensitiveQuery: true })) {
		record.thumbnail = source.thumbnail;
	}
	if (typeof source.savedFileName === "string") {
		record.savedFileName = source.savedFileName.slice(0, 512);
	}
	const selectedFormat = parseSelectedFormat(source.selectedFormat);
	if (selectedFormat) {
		record.selectedFormat = selectedFormat;
	}
	return record;
};

const generateBrowserId = (): string =>
	`browser:${
		typeof globalThis.crypto?.randomUUID === "function"
			? globalThis.crypto.randomUUID()
			: "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/gu, (token) => {
					const random = Math.floor(Math.random() * 16);
					return (token === "x" ? random : (random & 0x3) | 0x8).toString(16);
				})
	}`;

export const createBrowserHandedOffRecord = ({
	filename,
	handedOffAt = Date.now(),
	id = generateBrowserId(),
	selectedFormat,
	thumbnail,
	title,
	type,
	url,
}: CreateBrowserRecordInput): BrowserDownloadRecord => {
	const record = parseBrowserRecord({
		createdAt: handedOffAt,
		deliveryMode: "browser",
		entryType: "browser",
		handedOffAt,
		id,
		savedFileName: filename,
		selectedFormat,
		status: "handed-off",
		thumbnail,
		title,
		type,
		url,
	});
	if (!record) {
		throw new Error("Cannot create a browser hand-off record.");
	}
	return record;
};

const readHistory = (
	storage: StorageLike | undefined = getStorage(),
): { success: boolean; records: BrowserDownloadRecord[] } => {
	if (!storage) {
		return { success: false, records: [] };
	}
	try {
		const raw = storage.getItem(DIRECT_DOWNLOAD_HISTORY_STORAGE_KEY);
		const payload: unknown = raw ? JSON.parse(raw) : undefined;
		if (
			!payload ||
			typeof payload !== "object" ||
			(payload as Record<string, unknown>).version !== 1 ||
			!Array.isArray((payload as Record<string, unknown>).records)
		) {
			return { success: true, records: [] };
		}
		const records: BrowserDownloadRecord[] = [];
		for (const value of (payload as { records: unknown[] }).records) {
			const record = parseBrowserRecord(value);
			if (record) {
				records.push(record);
			}
			if (records.length === DIRECT_DOWNLOAD_HISTORY_MAX_ENTRIES) {
				break;
			}
		}
		const sanitizedPayload = JSON.stringify({ records, version: 1 });
		if (sanitizedPayload !== raw) {
			try {
				storage.setItem(DIRECT_DOWNLOAD_HISTORY_STORAGE_KEY, sanitizedPayload);
			} catch {
				// Keep the sanitized in-memory view when storage cannot be migrated.
			}
		}
		return { success: true, records };
	} catch {
		return { success: false, records: [] };
	}
};

export const readBrowserDownloadHistory = (
	storage: StorageLike | undefined = getStorage(),
): BrowserDownloadRecord[] => readHistory(storage).records;

export const readBrowserDownloadRecords = readBrowserDownloadHistory;

const writeHistory = (
	records: BrowserDownloadRecord[],
	storage: StorageLike | undefined = getStorage(),
): boolean => {
	try {
		storage?.setItem(
			DIRECT_DOWNLOAD_HISTORY_STORAGE_KEY,
			JSON.stringify({
				records: records.slice(0, DIRECT_DOWNLOAD_HISTORY_MAX_ENTRIES),
				version: 1,
			}),
		);
		return Boolean(storage);
	} catch {
		return false;
	}
};

export const addBrowserDownloadRecord = (
	record: BrowserDownloadRecord,
	storage: StorageLike | undefined = getStorage(),
): boolean => {
	const safeRecord = parseBrowserRecord(record);
	if (!safeRecord) {
		return false;
	}
	return writeHistory(
		[
			safeRecord,
			...readBrowserDownloadHistory(storage).filter(
				(existing) => existing.id !== safeRecord.id,
			),
		],
		storage,
	);
};

export const removeBrowserDownloadRecords = (
	ids: Iterable<string>,
	storage: StorageLike | undefined = getStorage(),
): BrowserHistoryRemovalResult => {
	const idSet = new Set(ids);
	const readResult = readHistory(storage);
	if (!readResult.success) {
		return { success: false, removedIds: [] };
	}
	const current = readResult.records;
	const next = current.filter((record) => !idSet.has(record.id));
	const removedIds = current
		.filter((record) => idSet.has(record.id))
		.map((record) => record.id);
	if (removedIds.length === 0) {
		return { success: true, removedIds };
	}
	return writeHistory(next, storage)
		? { success: true, removedIds }
		: { success: false, removedIds: [] };
};

const timestamp = (record: DownloadRecord): number =>
	record.entryType === "browser"
		? record.handedOffAt
		: (record.completedAt ?? record.createdAt);

export const mergeDownloadRecords = (
	serverRecords: ServerDownloadRecord[],
	browserRecords: BrowserDownloadRecord[],
): DownloadRecord[] => {
	const serverIds = new Set(serverRecords.map((record) => record.id));
	return [
		...serverRecords,
		...browserRecords.filter((record) => !serverIds.has(record.id)),
	]
		.map((record, index) => ({ index, record }))
		.sort(
			(left, right) =>
				timestamp(right.record) - timestamp(left.record) ||
				left.index - right.index,
		)
		.map(({ record }) => record);
};

export const removeBrowserRecordsFromList = (
	records: DownloadRecord[],
	ids: Iterable<string>,
): DownloadRecord[] => {
	const idSet = new Set(ids);
	return records.filter(
		(record) => record.entryType !== "browser" || !idSet.has(record.id),
	);
};

export const partitionDownloadRecordIds = (
	records: DownloadRecord[],
	ids: Iterable<string>,
): { browserIds: string[]; serverIds: string[] } => {
	const selectedIds = new Set(ids);
	const browserIds: string[] = [];
	const serverIds: string[] = [];
	for (const record of records) {
		if (!selectedIds.has(record.id)) {
			continue;
		}
		if (record.entryType === "browser") {
			browserIds.push(record.id);
		} else if (record.entryType === "history") {
			serverIds.push(record.id);
		}
	}
	return { browserIds, serverIds };
};
