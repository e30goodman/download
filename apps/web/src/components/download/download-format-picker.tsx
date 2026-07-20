import type { DownloadType } from "@vidbee/downloader-core";
import { Badge } from "@vidbee/ui/components/ui/badge";
import { Button } from "@vidbee/ui/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@vidbee/ui/components/ui/popover";
import { useTranslation } from "react-i18next";
import {
	getRowFormatOptions,
	type RowFormatPreset,
	type RowFormatSelection,
} from "../../lib/row-format-presets";

interface DownloadFormatPickerProps {
	type: DownloadType;
	selectedPreset: RowFormatPreset;
	qualityLabel?: string;
	formatLabel?: string;
	disabled?: boolean;
	onFormatSelect: (selection: RowFormatSelection) => void;
}

export const DownloadFormatPicker = ({
	type,
	selectedPreset,
	qualityLabel,
	formatLabel,
	disabled = false,
	onFormatSelect,
}: DownloadFormatPickerProps) => {
	const { t } = useTranslation();
	const options = getRowFormatOptions(type);

	if (!qualityLabel && !formatLabel) {
		return null;
	}

	return (
		<Popover>
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
				className="w-56 p-2"
				onClick={(event) => event.stopPropagation()}
			>
				<div className="space-y-2">
					<p className="px-1 font-medium text-sm">
						{t("download.chooseFormat")}
					</p>
					<div className="space-y-1">
						{options.map((option) => {
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
	);
};
