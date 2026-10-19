import { cp, copyFile, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extension = path.join(root, "extension");
const manifest = JSON.parse(await readFile(path.join(extension, "manifest.json")));
const output = path.join(root, "dist", `anitabi-enhancer-${manifest.version}.zip`);
await mkdir(path.dirname(output), { recursive: true });
await rm(output, { force: true });
async function listFiles(directory = "") {
  const files = [];
  for (const entry of await readdir(path.join(extension, directory), { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files.sort();
}
const files = await listFiles();
const staging = await mkdtemp(path.join(tmpdir(), "anitabi-package-"));
try {
  await cp(extension, staging, { recursive: true });
  for (const name of ["LICENSE", "NOTICE.md"]) await copyFile(path.join(root, name), path.join(staging, name));
  const result = spawnSync("zip", ["-q", output, ...files, "LICENSE", "NOTICE.md"], { cwd: staging, stdio: "inherit" });
  if (result.status !== 0) throw new Error("扩展打包失败");
} finally {
  await rm(staging, { recursive: true, force: true });
}
console.log(output);
