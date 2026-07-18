import { useNavigate } from "@tanstack/react-router";
import {
	AppSidebar,
	type AppSidebarItem,
} from "@vidbee/ui/components/ui/app-sidebar";
import { appSidebarIcons } from "@vidbee/ui/components/ui/app-sidebar-icons";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { siteConfig } from "../../lib/site-config";

type AppPage = "about" | "download" | "settings";

interface AppShellProps {
	children: ReactNode;
	page: AppPage;
}

export const AppShell = ({ children, page }: AppShellProps) => {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const logoSrc = `${import.meta.env.BASE_URL}app-icon.svg`;

	const items: AppSidebarItem[] = [
		{
			id: "home",
			active: page === "download",
			icon: appSidebarIcons.home,
			label: t("menu.download"),
			onClick: () => {
				void navigate({ to: "/" });
			},
		},
	];
	if (!siteConfig.isPublicSite) {
		items.push({
			id: "subscriptions",
			disabled: true,
			icon: appSidebarIcons.subscriptions,
			label: t("menu.rss"),
		});
		items.push({
			id: "supported-sites",
			icon: appSidebarIcons.supportedSites,
			label: t("menu.supportedSites"),
			onClick: () => {
				window.open(
					"https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md",
					"_blank",
					"noopener,noreferrer",
				);
			},
		});
	}

	const bottomItems: AppSidebarItem[] = [];
	if (!siteConfig.isPublicSite) {
		bottomItems.push({
			id: "settings",
			active: page === "settings",
			icon: appSidebarIcons.settings,
			label: t("menu.preferences"),
			showLabel: false,
			showTooltip: true,
			onClick: () => {
				void navigate({ to: "/settings" });
			},
		});
		bottomItems.push({
			id: "about",
			active: page === "about",
			icon: appSidebarIcons.about,
			label: t("menu.about"),
			onClick: () => {
				void navigate({ to: "/about" });
			},
			showLabel: false,
			showTooltip: true,
		});
	}

	return (
		<div className="flex h-screen flex-row">
			<AppSidebar
				appName={siteConfig.name}
				bottomItems={bottomItems}
				items={items}
				logoAlt={siteConfig.name}
				logoSrc={logoSrc}
			/>

			<main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
				<div className="h-full flex-1 overflow-y-auto overflow-x-hidden">
					{children}
				</div>
			</main>
		</div>
	);
};
