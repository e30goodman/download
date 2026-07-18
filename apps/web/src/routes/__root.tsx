import { TanStackDevtools } from "@tanstack/react-devtools";
import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { useEffect } from "react";
import { Toaster } from "sonner";
import { i18n } from "../lib/i18n";
import { siteConfig } from "../lib/site-config";
import { applyThemeToDocument, readWebSettings } from "../lib/web-settings";

import appCss from "../styles.css?url";

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				title: `${siteConfig.name} — video downloader`,
			},
		],
		links: [
			{
				rel: "stylesheet",
				href: appCss,
			},
			{
				rel: "icon",
				href: `${import.meta.env.BASE_URL}app-icon.svg`,
				type: "image/svg+xml",
			},
			{
				rel: "manifest",
				href: `${import.meta.env.BASE_URL}manifest.json`,
			},
		],
	}),
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body className="bg-background text-foreground" suppressHydrationWarning>
				<RootHydrationEffects />
				{children}
				<Toaster richColors={true} />
				{import.meta.env.DEV ? (
					<TanStackDevtools
						config={{
							position: "bottom-right",
						}}
						plugins={[
							{
								name: "Tanstack Router",
								render: <TanStackRouterDevtoolsPanel />,
							},
						]}
					/>
				) : null}
				<Scripts />
			</body>
		</html>
	);
}

function RootHydrationEffects() {
	useEffect(() => {
		const settings = readWebSettings();
		applyThemeToDocument(settings.theme);
		void i18n.changeLanguage(settings.language);
	}, []);

	return null;
}
