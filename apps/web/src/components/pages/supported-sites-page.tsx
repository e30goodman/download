import { Badge } from "@vidbee/ui/components/ui/badge";
import { Button } from "@vidbee/ui/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@vidbee/ui/components/ui/card";
import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
	HIGHLIGHTED_SITE_KEYS,
	POPULAR_SITE_KEYS,
	POPULAR_SITE_URLS,
	YTDLP_SUPPORTED_SITES_URL,
} from "../../lib/supported-sites";
import { AppShell } from "../layout/app-shell";

export const SupportedSitesPage = () => {
	const { t } = useTranslation();

	return (
		<AppShell page="supported-sites">
			<div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
				<div className="space-y-2">
					<h1 className="font-semibold text-2xl tracking-tight">
						{t("sites.pageTitle")}
					</h1>
					<p className="max-w-3xl text-muted-foreground text-sm">
						{t("sites.pageDescription")}
					</p>
					<p className="max-w-3xl text-muted-foreground text-sm">
						{t("sites.pageIntro")}
					</p>
				</div>

				<section className="space-y-4">
					<h2 className="font-medium text-lg">{t("sites.popularSection")}</h2>
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{POPULAR_SITE_KEYS.map((siteKey) => (
							<Card className="h-full" key={siteKey}>
								<CardHeader className="pb-2">
									<CardTitle className="text-base">
										<a
											className="inline-flex items-center gap-1.5 text-primary hover:underline"
											href={POPULAR_SITE_URLS[siteKey]}
											rel="noopener noreferrer"
											target="_blank"
										>
											{t(`sites.popular.${siteKey}.label`)}
											<ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-70" />
										</a>
									</CardTitle>
								</CardHeader>
								<CardContent>
									<CardDescription className="text-sm leading-relaxed">
										{t(`sites.popular.${siteKey}.description`)}
									</CardDescription>
								</CardContent>
							</Card>
						))}
					</div>
				</section>

				<Card>
					<CardHeader>
						<CardTitle className="text-base">{t("sites.moreTitle")}</CardTitle>
						<CardDescription>{t("sites.moreDescription")}</CardDescription>
					</CardHeader>
					<CardContent className="flex flex-wrap items-center gap-3">
						<div className="flex flex-wrap gap-2">
							{HIGHLIGHTED_SITE_KEYS.map((siteKey) => (
								<Badge asChild key={siteKey} variant="secondary">
									<a
										href={POPULAR_SITE_URLS[siteKey]}
										rel="noopener noreferrer"
										target="_blank"
									>
										{t(`sites.popular.${siteKey}.label`)}
									</a>
								</Badge>
							))}
							<Badge variant="outline">1000+</Badge>
						</div>
						<Button asChild className="gap-2" variant="outline">
							<a
								href={YTDLP_SUPPORTED_SITES_URL}
								rel="noopener noreferrer"
								target="_blank"
							>
								{t("sites.openFullList")}
								<ExternalLink className="h-4 w-4" />
							</a>
						</Button>
					</CardContent>
				</Card>
			</div>
		</AppShell>
	);
};
