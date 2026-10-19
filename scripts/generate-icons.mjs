import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "assets", "anitabi-favicon.ico");
const output = path.join(root, "extension", "icons");
await mkdir(output, { recursive: true });

// Use Anitabi's original 16px favicon. Nearest-neighbor scaling preserves its
// pixel art and transparency; no additional background or symbol is added.
for (const size of [16, 20, 24, 32, 48, 64, 128]) {
  const result = spawnSync("magick", [
    source, "-filter", "point", "-resize", `${size}x${size}`, "-strip",
    `PNG32:${path.join(output, `icon-${size}.png`)}`,
  ], { stdio: "inherit" });
  if (result.error?.code === "ENOENT") throw new Error("生成图标需要 ImageMagick（magick）；PNG 已随项目保存，日常打包无需重新生成。");
  if (result.status !== 0) throw new Error(`生成 ${size}px 图标失败`);
}
console.log("已从 Anitabi 原图生成 16、20、24、32、48、64、128px PNG。");
