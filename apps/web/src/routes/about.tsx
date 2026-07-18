import { createFileRoute } from "@tanstack/react-router";
import { AboutPage } from "../components/pages/about-page";
import { PublicAboutPage } from "../components/pages/public-about-page";
import { siteConfig } from "../lib/site-config";

export const Route = createFileRoute("/about")({
	component: siteConfig.isPublicSite ? PublicAboutPage : AboutPage,
});
