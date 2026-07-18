import { createFileRoute, redirect } from "@tanstack/react-router";
import { SettingsPage } from "../components/pages/settings-page";
import { siteConfig } from "../lib/site-config";

export const Route = createFileRoute("/settings")({
	beforeLoad: () => {
		if (siteConfig.isPublicSite) {
			throw redirect({ to: "/" });
		}
	},
	component: SettingsPage,
});
