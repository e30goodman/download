import type { DownloadType } from "@vidbee/downloader-core";
import { Badge } from "@vidbee/ui/components/ui/badge";
import { Button } from "@vidbee/ui/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@vidbee/ui/components/ui/popover";
import { useTranslation } from "react-i18next";

interface DownloadTypePickerProps {
	selectedType: DownloadType;
	disabled?: boolean;
	onTypeSelect: (type: DownloadType) => void;
}

const TYPE_ORDER: DownloadType[] = ["video", "audio", "text"];

export const DownloadTypePicker = ({
	selectedType,
	disabled = false,
	onTypeSelect,
}: DownloadTypePickerProps) => {
	const { t } = useTranslation();

	return (
		<Popover>
			<PopoverTrigger asChild>
				<button
					className="inline-flex items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					disabled={disabled}
					onClick={(event) => event.stopPropagation()}
					onKeyDown={(event) => event.stopPropagation()}
					type="button"
				>
					<Badge className="shrink-0 px-1.5 py-0.5 text-[10px]" variant="secondary">
						{t(`download.${selectedType}`)}
					</Badge>
				</button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				className="w-48 p-2"
				onClick={(event) => event.stopPropagation()}
			>
				<div className="space-y-2">
					<p className="px-1 font-medium text-sm">{t("download.chooseType")}</p>
					<div className="space-y-1">
						{TYPE_ORDER.map((type) => (
							<Button
								className="h-9 w-full justify-start px-2"
								key={type}
								onClick={() => onTypeSelect(type)}
								size="sm"
								variant={selectedType === type ? "secondary" : "ghost"}
							>
								{t(`download.${type}`)}
							</Button>
						))}
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
};
