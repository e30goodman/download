const configuredSiteName = import.meta.env.VITE_SITE_NAME?.trim();

export const siteConfig = {
	isPublicSite: import.meta.env.VITE_PUBLIC_SITE === "true",
	name: configuredSiteName || "Download",
	publicUrl: "https://e30goodman.github.io/download/",
	repositoryUrl: "https://github.com/e30goodman/download",
} as const;
