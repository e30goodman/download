import type { DownloadType } from "@vidbee/downloader-core";
import { Badge } from "@vidbee/ui/components/ui/badge";
import { Button } from "@vidbee/ui/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@vidbee/ui/components/ui/popover";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
	getRowFormatOptions,
	getRowVideoContainerOptions,
	type RowFormatPreset,
	type RowFormatSelection,
	type RowVideoContainer,
} from "../../lib/row-format-presets";

interface DownloadFormatPickerProps {
	type: DownloadType;
	selectedPreset: RowFormatPreset;
	selectedContainer?: RowVideoContainer;
	qualityLabel?: string;
	formatLabel?: string;
	disabled?: boolean;
	onFormatSelect: (selection: RowFormatSelection) => void;
	onContainerSelect?: (container: RowVideoContainer) => void;
}

export const DownloadFormatPicker = ({
	type,
	selectedPreset,
	selectedContainer = "mp4",
	qualityLabel,
	formatLabel,
	disabled = false,
	onFormatSelect,
	onContainerSelect,
}: DownloadFormatPickerProps) => {
	const { t } = useTranslation();
	const [qualityOpen, setQualityOpen] = useState(false);
	const [formatOpen, setFormatOpen] = useState(false);
	const qualityOptions = type === "video" ? getRowFormatOptions("video") : [];
	const formatOptions = type === "video" ? [] : getRowFormatOptions(type);

	if (!qualityLabel && !formatLabel) {
		return null;
	}

	return (
		<div className="inline-flex items-center gap-1">
			{qualityLabel ? (
				<Popover onOpenChange={setQualityOpen} open={qualityOpen}>
					<PopoverTrigger asChild>
						<button
							className="inline-flex min-h-8 items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							disabled={disabled}
							onClick={(event) => event.stopPropagation()}
							onKeyDown={(event) => event.stopPropagation()}
							onPointerDown={(event) => event.stopPropagation()}
							type="button"
						>
							<Badge className="shrink-0 px-2 py-0.5 text-[11px]">
								{qualityLabel}
							</Badge>
						</button>
					</PopoverTrigger>
					<PopoverContent
						align="start"
						className="z-50 w-56 p-2"
						collisionPadding={12}
						onClick={(event) => event.stopPropagation()}
						onOpenAutoFocus={(event) => event.preventDefault()}
					>
						<div className="space-y-2">
							<p className="px-1 font-medium text-sm">
								{t("download.chooseFormat")}
							</p>
							<div className="space-y-1">
								{qualityOptions.map((option) => {
									const isSelected = option.preset === selectedPreset;
									return (
										<Button
											className="h-9 w-full justify-start px-2"
											key={option.preset}
											onClick={() => {
												onFormatSelect({
													type,
													preset: option.preset,
												});
												setQualityOpen(false);
											}}
											size="sm"
											variant={isSelected ? "secondary" : "ghost"}
										>
											{option.label}
										</Button>
									);
								})}
							</div>
						</div>
					</PopoverContent>
				</Popover>
			) : null}

			{formatLabel ? (
				<Popover onOpenChange={setFormatOpen} open={formatOpen}>
					<PopoverTrigger asChild>
						<button
							className="inline-flex min-h-8 items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							disabled={disabled}
							onClick={(event) => event.stopPropagation()}
							onKeyDown={(event) => event.stopPropagation()}
							onPointerDown={(event) => event.stopPropagation()}
							type="button"
						>
							<Badge
								className="shrink-0 px-2 py-0.5 text-[11px]"
								variant="secondary"
							>
								{formatLabel}
							</Badge>
						</button>
					</PopoverTrigger>
					<PopoverContent
						align="start"
						className="z-50 w-56 p-2"
						collisionPadding={12}
						onClick={(event) => event.stopPropagation()}
						onOpenAutoFocus={(event) => event.preventDefault()}
					>
						<div className="space-y-2">
							<p className="px-1 font-medium text-sm">
								{t("download.chooseFormat")}
							</p>
							<div className="space-y-1">
								{type === "video"
									? getRowVideoContainerOptions().map((option) => {
											const isSelected = option.container === selectedContainer;
											return (
												<Button
													className="h-9 w-full justify-start px-2"
													key={option.container}
													onClick={() => {
														onContainerSelect?.(option.container);
														setFormatOpen(false);
													}}
													size="sm"
													variant={isSelected ? "secondary" : "ghost"}
												>
													{option.label}
												</Button>
											);
										})
									: formatOptions.map((option) => {
											const isSelected = option.preset === selectedPreset;
											return (
												<Button
													className="h-9 w-full justify-start px-2"
													key={option.preset}
													onClick={() => {
														onFormatSelect({
															type,
															preset: option.preset,
														});
														setFormatOpen(false);
													}}
													size="sm"
													variant={isSelected ? "secondary" : "ghost"}
												>
													{option.label}
												</Button>
											);
										})}
							</div>
						</div>
					</PopoverContent>
				</Popover>
			) : null}
		</div>
	);
};
