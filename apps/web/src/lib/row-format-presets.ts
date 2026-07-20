import type { DownloadType } from "@vidbee/downloader-core";
import {
	buildAudioFormatPreference,
	buildVideoFormatPreference,
} from "@vidbee/downloader-core/format-preferences";
import type { DownloadRecord } from "../components/download/types";

export type RowVideoPreset = "original" | "1080" | "720" | "360";
export type RowAudioPreset = "mp3" | "wav";
export type RowTextPreset = "txt" | "md";
export type RowFormatPreset = RowVideoPreset | RowAudioPreset | RowTextPreset;

export interface RowFormatOption {
	preset: RowFormatPreset;
	label: string;
}

export interface RowFormatSelection {
	type: DownloadType;
	preset: RowFormatPreset;
}

const VIDEO_PRESET_ORDER: RowVideoPreset[] = [
	"original",
	"1080",
	"720",
	"360",
];
const AUDIO_PRESET_ORDER: RowAudioPreset[] = ["mp3", "wav"];
const TEXT_PRESET_ORDER: RowTextPreset[] = ["txt", "md"];

const VIDEO_PRESET_LABELS: Record<RowVideoPreset, string> = {
	original: "Original",
	"1080": "1080p",
	"720": "720p",
	"360": "360p",
};

const AUDIO_PRESET_LABELS: Record<RowAudioPreset, string> = {
	mp3: "MP3",
	wav: "WAV",
};

const TEXT_PRESET_LABELS: Record<RowTextPreset, string> = {
	txt: "TXT",
	md: "MD",
};

export const getRowFormatOptions = (type: DownloadType): RowFormatOption[] => {
	if (type === "video") {
		return VIDEO_PRESET_ORDER.map((preset) => ({
			preset,
			label: VIDEO_PRESET_LABELS[preset],
		}));
	}
	if (type === "audio") {
		return AUDIO_PRESET_ORDER.map((preset) => ({
			preset,
			label: AUDIO_PRESET_LABELS[preset],
		}));
	}
	return TEXT_PRESET_ORDER.map((preset) => ({
		preset,
		label: TEXT_PRESET_LABELS[preset],
	}));
};

export const getDefaultRowPresetForType = (
	type: DownloadType,
): RowFormatPreset => {
	if (type === "video") {
		return "original";
	}
	if (type === "audio") {
		return "mp3";
	}
	return "txt";
};

export const getRowFormatPresetLabel = (
	type: DownloadType,
	preset: RowFormatPreset,
): string => {
	if (type === "video") {
		return VIDEO_PRESET_LABELS[preset as RowVideoPreset];
	}
	if (type === "audio") {
		return AUDIO_PRESET_LABELS[preset as RowAudioPreset];
	}
	return TEXT_PRESET_LABELS[preset as RowTextPreset];
};

const videoPresetToQuality = (
	preset: RowVideoPreset,
): "best" | "good" | "normal" | "worst" => {
	switch (preset) {
		case "original":
			return "best";
		case "1080":
			return "good";
		case "720":
			return "normal";
		case "360":
			return "worst";
	}
};

export const buildFormatSelectorFromPreset = (
	selection: RowFormatSelection,
): { format?: string; audioFormat?: string } => {
	if (selection.type === "video") {
		return {
			format: buildVideoFormatPreference({
				oneClickQuality: videoPresetToQuality(
					selection.preset as RowVideoPreset,
				),
			}),
		};
	}
	if (selection.type === "audio") {
		return {
			format: buildAudioFormatPreference({ oneClickQuality: "best" }),
			audioFormat: selection.preset as RowAudioPreset,
		};
	}
	return {
		audioFormat: selection.preset as RowTextPreset,
	};
};

export const inferVideoPresetFromDownload = (
	download: DownloadRecord,
): RowVideoPreset => {
	const height = download.selectedFormat?.height;
	if (!height || height > 1080) {
		return "original";
	}
	if (height > 720) {
		return "1080";
	}
	if (height > 360) {
		return "720";
	}
	return "360";
};

export const inferAudioPresetFromDownload = (
	download: DownloadRecord,
): RowAudioPreset => {
	const ext =
		download.selectedFormat?.ext?.toLowerCase() ??
		download.savedFileName?.split(".").pop()?.toLowerCase();
	return ext === "wav" ? "wav" : "mp3";
};

export const inferTextPresetFromDownload = (
	download: DownloadRecord,
): RowTextPreset => {
	const ext = download.savedFileName?.split(".").pop()?.toLowerCase();
	return ext === "md" ? "md" : "txt";
};

export const inferRowFormatPreset = (
	download: DownloadRecord,
): RowFormatPreset => {
	if (download.type === "audio") {
		return inferAudioPresetFromDownload(download);
	}
	if (download.type === "text") {
		return inferTextPresetFromDownload(download);
	}
	return inferVideoPresetFromDownload(download);
};

export const getRowFormatDisplay = (
	download: DownloadRecord,
): { qualityLabel?: string; formatLabel?: string } => {
	const preset = inferRowFormatPreset(download);
	if (download.type === "video") {
		return {
			qualityLabel: VIDEO_PRESET_LABELS[preset as RowVideoPreset],
		};
	}
	if (download.type === "audio") {
		return {
			formatLabel: AUDIO_PRESET_LABELS[preset as RowAudioPreset],
		};
	}
	return {
		formatLabel: TEXT_PRESET_LABELS[preset as RowTextPreset],
	};
};
