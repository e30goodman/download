import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import Icons from "unplugin-icons/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import packageJson from "./package.json";

const normalizeBasePath = (value: string | undefined): string => {
	const trimmedValue = value?.trim();
	if (!trimmedValue || trimmedValue === "/") {
		return "/";
	}

	return `/${trimmedValue.replace(/^\/+|\/+$/g, "")}/`;
};

const basePath = normalizeBasePath(process.env.VITE_BASE_PATH);

// Self-hosters behind a reverse proxy (e.g. Traefik) must allow their domain
// in Vite's host check (GitHub issue #404). VIDBEE_ALLOWED_HOSTS="*" (or "all")
// disables the check; a comma-separated list allows specific hosts; unset keeps
// Vite's secure localhost default.
function resolveAllowedHosts(): true | string[] | undefined {
	const raw = process.env.VIDBEE_ALLOWED_HOSTS?.trim();
	if (!raw) {
		return undefined;
	}
	if (raw === "*" || raw === "all") {
		return true;
	}
	return raw
		.split(",")
		.map((host) => host.trim())
		.filter(Boolean);
}

const config = defineConfig({
	base: basePath,
	define: {
		__APP_VERSION__: JSON.stringify(packageJson.version),
	},
	plugins: [
		devtools({
			eventBusConfig: {
				enabled: false,
			},
		}),
		tsconfigPaths({ projects: ["./tsconfig.json"] }),
		Icons({
			compiler: "jsx",
			jsx: "react",
		}),
		tailwindcss(),
		tanstackStart({
			spa: {
				enabled: true,
			},
		}),
		viteReact(),
	],
	server: {
		allowedHosts: resolveAllowedHosts(),
		proxy: {
			"/events": {
				target: "http://localhost:3100",
				changeOrigin: true,
			},
			"/rpc": {
				target: "http://localhost:3100",
				changeOrigin: true,
			},
			"/images": {
				target: "http://localhost:3100",
				changeOrigin: true,
			},
		},
	},
	ssr: {
		noExternal: ["@vidbee/i18n"],
	},
});

export default config;
