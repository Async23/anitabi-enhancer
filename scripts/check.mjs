import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

const manifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url)));
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions, ["storage", "scripting"]);
assert.deepEqual(manifest.host_permissions, manifest.content_scripts[0].matches);
assert(manifest.content_scripts.every((script) => script.matches.every((url) => url.includes("anitabi.cn/"))));
assert.equal(manifest.action.default_popup, undefined, "设置应只在地图内显示");
const required = new Set();
if (manifest.background?.service_worker) required.add(manifest.background.service_worker);
for (const icons of [manifest.icons, manifest.action.default_icon]) {
  assert(icons && typeof icons === "object", "应配置扩展及工具栏图标");
  for (const [size, file] of Object.entries(icons)) {
    required.add(file);
    const png = await readFile(new URL(`../extension/${file}`, import.meta.url));
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${file} 应为 PNG`);
    assert.equal(png.readUInt32BE(16), Number(size), `${file} 宽度与清单不符`);
    assert.equal(png.readUInt32BE(20), Number(size), `${file} 高度与清单不符`);
  }
}
for (const script of manifest.content_scripts) for (const file of [...script.js || [], ...script.css || []]) required.add(file);
for (const file of required) await readFile(new URL(`../extension/${file}`, import.meta.url));
for (const directory of ["extension", "scripts", "tests"]) {
  for (const file of await readdir(new URL(`../${directory}/`, import.meta.url))) {
    if (!/\.m?js$/.test(file)) continue;
    const result = spawnSync(process.execPath, ["--check", `${directory}/${file}`], { stdio: "inherit" });
    assert.equal(result.status, 0, `${directory}/${file} 语法检查失败`);
  }
}
console.log("扩展清单、资源和 JavaScript 语法检查通过。");
