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
	POPULAR_SITE_KEYS,
	POPULAR_SITE_URLS,
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
			</div>
		</AppShell>
	);
};
