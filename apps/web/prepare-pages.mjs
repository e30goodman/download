import { copyFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = path.dirname(fileURLToPath(import.meta.url));
const outputDirectory = path.join(appDirectory, "dist", "client");
const shellPath = path.join(outputDirectory, "_shell.html");

await Promise.all([
	copyFile(shellPath, path.join(outputDirectory, "index.html")),
	copyFile(shellPath, path.join(outputDirectory, "404.html")),
	writeFile(path.join(outputDirectory, ".nojekyll"), ""),
]);
