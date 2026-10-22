import { Config } from "@remotion/cli/config";
import { existsSync } from "node:fs";

Config.setChromiumOpenGlRenderer("angle");
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);

for (const executable of [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium-browser",
]) {
  if (existsSync(executable)) {
    Config.setBrowserExecutable(executable);
    break;
  }
}
