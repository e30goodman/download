import { Button } from "@vidbee/ui/components/ui/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@vidbee/ui/components/ui/card";
import { Download, Github } from "lucide-react";
import { useTranslation } from "react-i18next";
import { siteConfig } from "../../lib/site-config";
import { AppShell } from "../layout/app-shell";

export const PublicAboutPage = () => {
	const { t } = useTranslation();
	const logoSrc = `${import.meta.env.BASE_URL}app-icon.svg`;

	return (
		<AppShell page="about">
			<div className="container mx-auto max-w-3xl space-y-6 p-6">
				<Card>
					<CardContent className="flex flex-col gap-5 pt-6 sm:flex-row sm:items-center">
						<img
							alt={siteConfig.name}
							className="h-20 w-20 rounded-2xl"
							src={logoSrc}
						/>
						<div className="space-y-2">
							<h1 className="font-semibold text-3xl">{siteConfig.name}</h1>
							<p className="text-muted-foreground">{t("app.description")}</p>
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>{t("download.enterUrl")}</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="flex gap-3">
							<Download className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
							<p className="text-muted-foreground text-sm">
								{t("download.enterUrlDescription")}
							</p>
						</div>
					</CardContent>
				</Card>

				<Button asChild variant="outline">
					<a
						href={siteConfig.repositoryUrl}
						rel="noopener noreferrer"
						target="_blank"
					>
						<Github className="h-4 w-4" />
						{t("about.sourceCode")}
					</a>
				</Button>
			</div>
		</AppShell>
	);
};
