import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

// Optional test-only transport for machines where a newly downloaded browser
// cannot make outbound connections. The actual site code still runs in Chromium.
export async function useCurlTransport(context) {
  const directory = await mkdtemp(path.join(tmpdir(), "anitabi-http-"));
  let sequence = 0;
  await context.route(/^https?:\/\//, async (route) => {
    const request = route.request();
    const headersFile = path.join(directory, String(sequence++));
    const args = ["--silent", "--show-error", "--location", "--compressed", "--max-time", "25", "--dump-header", headersFile];
    for (const [name, value] of Object.entries(request.headers())) {
      if (["accept", "accept-language", "origin", "referer", "content-type"].includes(name)) {
        args.push("--header", `${name}: ${value}`);
      }
    }
    args.push("--request", request.method());
    if (request.postData()) args.push("--data-raw", request.postData());
    args.push(request.url());
    try {
      const { stdout } = await execute("curl", args, { encoding: "buffer", maxBuffer: 32 * 1024 * 1024 });
      const blocks = (await readFile(headersFile, "utf8")).trim().split(/\r?\n\r?\n/);
      const lines = blocks.at(-1).split(/\r?\n/);
      const status = Number(lines.shift().split(" ")[1]);
      const headers = {};
      for (const line of lines) {
        const separator = line.indexOf(":");
        if (separator < 0) continue;
        const name = line.slice(0, separator).toLowerCase();
        if (["content-encoding", "content-length", "transfer-encoding"].includes(name)) continue;
        headers[name] = line.slice(separator + 1).trim();
      }
      await route.fulfill({ status, headers, body: stdout });
    } catch {
      await route.abort().catch(() => {});
    } finally {
      await rm(headersFile, { force: true });
    }
  });
  return () => rm(directory, { force: true, recursive: true });
}
