import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PlaywrightBrowserAdapter } from "../../packages/adapters/dist/index.js";

test("dedicated Playwright session inspects and observes an owned fixture", async (context) => {
  const html = await readFile(
    new URL("../fixtures/browser-site.html", import.meta.url),
    "utf8",
  );
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const root = await mkdtemp(join(tmpdir(), "synlet-browser-"));
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const browser = new PlaywrightBrowserAdapter(
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    root,
    { allowedDomains: ["127.0.0.1"], maxTextChars: 4096, headless: true },
  );
  const url = `http://127.0.0.1:${address.port}/`;
  const inspected = await browser.inspect(url);
  assert.equal(inspected.title, "Owned fixture");
  assert.match(inspected.text, /Waiting/u);
  const observed = await browser.clickAndObserve(url, "button", "Reveal");
  assert.match(observed.text, /Observed after action/u);
  const typed = await browser.typeAndObserve(
    url,
    "Agent input",
    "typed by agent",
    false,
  );
  assert.match(typed.text, /typed by agent/u);
  await assert.rejects(
    browser.inspect("https://example.com"),
    (error) => error?.code === "POLICY_DENIED",
  );
});
