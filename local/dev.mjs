import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const bridge = spawn(process.execPath, [fileURLToPath(new URL("./subscription-bridge.mjs", import.meta.url))], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
  windowsHide: true,
});

const vinextArgs = [fileURLToPath(new URL("../node_modules/vinext/dist/cli.js", import.meta.url)), "dev"];
if (process.argv.includes("--lan")) vinextArgs.push("--hostname", "0.0.0.0", "--port", "3002");
const web = spawn(process.execPath, vinextArgs, {
  cwd: root,
  env: process.env,
  stdio: "inherit",
  windowsHide: true,
});

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  if (bridge.exitCode === null) bridge.kill();
  if (web.exitCode === null) web.kill();
  setTimeout(() => process.exit(code), 100).unref();
}

bridge.on("exit", (code) => {
  if (!stopping) {
    process.stderr.write(`Subscription bridge stopped unexpectedly (${code ?? "unknown"}).\n`);
    stop(code || 1);
  }
});
web.on("exit", (code) => stop(code || 0));
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
