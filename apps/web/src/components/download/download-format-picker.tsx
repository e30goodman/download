import type { DownloadType, VideoFormat } from "@vidbee/downloader-core";
import { Badge } from "@vidbee/ui/components/ui/badge";
import { Button } from "@vidbee/ui/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@vidbee/ui/components/ui/popover";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { orpcClient } from "../../lib/orpc-client";
import { readOrpcDownloadSettings } from "../../lib/orpc-download-settings";
import {
	formatAudioQualityLabel,
	formatCodecSummary,
	formatVideoQualityLabel,
	getSelectableFormats,
} from "../../lib/video-formats";

interface DownloadFormatPickerProps {
	url: string;
	type: DownloadType;
	selectedFormatId?: string;
	qualityLabel?: string;
	formatLabel?: string;
	disabled?: boolean;
	onFormatSelect: (format: VideoFormat) => void;
}

export const DownloadFormatPicker = ({
	url,
	type,
	selectedFormatId,
	qualityLabel,
	formatLabel,
	disabled = false,
	onFormatSelect,
}: DownloadFormatPickerProps) => {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [formats, setFormats] = useState<VideoFormat[]>([]);

	useEffect(() => {
		if (!open) {
			return;
		}

		let cancelled = false;
		const loadFormats = async () => {
			setLoading(true);
			setError(null);
			try {
				const result = await orpcClient.videoInfo({
					url,
					settings: readOrpcDownloadSettings(),
				});
				if (cancelled) {
					return;
				}
				setFormats(
					getSelectableFormats(result.video.formats, type),
				);
			} catch (loadError) {
				if (cancelled) {
					return;
				}
				const message =
					loadError instanceof Error && loadError.message
						? loadError.message
						: t("errors.fetchInfoFailed");
				setError(message);
				setFormats([]);
			} finally {
				if (!cancelled) {
					setLoading(false);
				}
			}
		};

		void loadFormats();

		return () => {
			cancelled = true;
		};
	}, [open, t, type, url]);

	if (type === "text" || (!qualityLabel && !formatLabel)) {
		return null;
	}

	return (
		<Popover onOpenChange={setOpen} open={open}>
			<PopoverTrigger asChild>
				<button
					className="inline-flex items-center gap-1 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					disabled={disabled}
					onClick={(event) => event.stopPropagation()}
					onKeyDown={(event) => event.stopPropagation()}
					type="button"
				>
					{qualityLabel ? (
						<Badge className="shrink-0 px-1.5 py-0 text-[10px]">
							{qualityLabel}
						</Badge>
					) : null}
					{formatLabel ? (
						<Badge
							className="shrink-0 px-1.5 py-0 text-[10px]"
							variant="secondary"
						>
							{formatLabel}
						</Badge>
					) : null}
				</button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				className="w-72 p-2"
				onClick={(event) => event.stopPropagation()}
			>
				<div className="space-y-2">
					<p className="px-1 font-medium text-sm">
						{t("download.chooseFormat")}
					</p>
					{loading ? (
						<div className="flex items-center justify-center py-6 text-muted-foreground">
							<Loader2 className="h-4 w-4 animate-spin" />
						</div>
					) : null}
					{error ? (
						<p className="px-1 text-destructive text-xs">{error}</p>
					) : null}
					{!loading && !error ? (
						<div className="max-h-64 space-y-1 overflow-y-auto">
							{formats.map((format) => {
								const qualityLabelValue =
									type === "audio"
										? formatAudioQualityLabel(format)
										: formatVideoQualityLabel(format);
								const isSelected = format.formatId === selectedFormatId;
								return (
									<Button
										className="h-auto w-full justify-between px-2 py-2 text-left"
										key={format.formatId}
										onClick={() => {
											onFormatSelect(format);
											setOpen(false);
										}}
										size="sm"
										variant={isSelected ? "secondary" : "ghost"}
									>
										<span className="font-medium">{qualityLabelValue}</span>
										<span className="text-muted-foreground text-xs">
											{formatCodecSummary(format)}
										</span>
									</Button>
								);
							})}
						</div>
					) : null}
				</div>
			</PopoverContent>
		</Popover>
	);
};
