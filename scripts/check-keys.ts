// npm run check:keys [-- --images] [-- --agent]
// Tests every key stored in data/settings.json. Prints a report without keys and saves it to data/diagnose.txt.
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { SettingsStore, diagnose, formatReport } from "@openmotion/server";

const root = path.resolve(import.meta.dirname, "..");
const dataDir = path.resolve(process.env.OPENMOTION_DATA ?? path.join(root, "data"));
const settings = await new SettingsStore(dataDir).read();
console.log("Teste Verbindungen …\n");
const checks = await diagnose(settings, { images: process.argv.includes("--images"), agent: process.argv.includes("--agent"), exampleSpec: path.join(root, "examples/explainer/spec.json") });
const report = formatReport(checks, settings);
console.log(report);
await writeFile(path.join(dataDir, "diagnose.txt"), report + "\n");
console.log(`\nBericht gespeichert: ${path.join(dataDir, "diagnose.txt")} (enthält keine Keys)`);
process.exit(checks.some((c) => c.ok === false) ? 1 : 0);
