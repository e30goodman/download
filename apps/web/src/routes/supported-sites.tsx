import { createFileRoute } from "@tanstack/react-router";
import { SupportedSitesPage } from "../components/pages/supported-sites-page";

export const Route = createFileRoute("/supported-sites")({
	component: SupportedSitesPage,
});
