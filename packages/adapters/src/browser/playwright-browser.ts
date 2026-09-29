import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { DomainError } from "@synlet/core";
import { chromium, type BrowserContext, type Page } from "playwright-core";
export interface BrowserPolicy {
  readonly allowedDomains: readonly string[];
  readonly maxTextChars: number;
  readonly headless: boolean;
}
export class PlaywrightBrowserAdapter {
  private context: BrowserContext | undefined;
  private page: Page | undefined;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly executablePath: string,
    private readonly profileRoot: string,
    private readonly policy: BrowserPolicy,
  ) {}
  async inspect(url: string, signal?: AbortSignal) {
    return this.withPage(url, (page) => this.observe(page), signal);
  }
  async screenshot(url: string, signal?: AbortSignal) {
    return this.withPage(
      url,
      async (page) => ({
        ...(await this.observe(page)),
        imageDataUrl: `data:image/png;base64,${(await page.screenshot({ fullPage: false })).toString("base64")}`,
      }),
      signal,
    );
  }
  async search(query: string, signal?: AbortSignal) {
    if (!query.trim() || query.length > 2048)
      throw new DomainError("INVALID_OUTPUT", "Invalid search query");
    const url = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`;
    this.validateUrl(url);
    const combined = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
      : AbortSignal.timeout(30000);
    const response = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 Synlet/1.0" },
      signal: combined,
    });
    if (!response.ok)
      throw new DomainError(
        "CAPABILITY_UNAVAILABLE",
        `Search provider HTTP ${response.status}`,
      );
    const xml = await response.text();
    const items = [
      ...xml.matchAll(
        /<item><title>([\s\S]*?)<\/title><link>([\s\S]*?)<\/link><description>([\s\S]*?)<\/description>/gu,
      ),
    ]
      .slice(0, 10)
      .map((match) => ({
        title: decodeXml(match[1] ?? ""),
        url: decodeXml(match[2] ?? ""),
        description: decodeXml(match[3] ?? ""),
      }));
    if (!items.length)
      throw new DomainError("INVALID_OUTPUT", "Search returned no results");
    return {
      url,
      title: `Search results for ${query}`,
      observedAtUtc: new Date().toISOString(),
      items,
      text: items
        .map(
          (item, index) =>
            `${index + 1}. ${item.title}\n${item.url}\n${item.description}`,
        )
        .join("\n\n"),
    };
  }
  async clickAndObserve(
    url: string,
    role: "button" | "link",
    name: string,
    signal?: AbortSignal,
  ) {
    return this.withPage(
      url,
      async (page) => {
        await page.getByRole(role, { name, exact: true }).click();
        await page.waitForLoadState("domcontentloaded");
        return this.observe(page);
      },
      signal,
    );
  }
  async typeAndObserve(
    url: string,
    label: string,
    value: string,
    submit: boolean,
    signal?: AbortSignal,
  ) {
    return this.withPage(
      url,
      async (page) => {
        const box = page.getByRole("textbox", { name: label, exact: true });
        await box.fill(value);
        if (submit) await box.press("Enter");
        const observation = await this.observe(page);
        return {
          ...observation,
          text: `${observation.text}\n[Filled textbox: ${label} = ${value}]`,
        };
      },
      signal,
    );
  }
  async close(): Promise<void> {
    const context = this.context;
    this.context = undefined;
    this.page = undefined;
    await context?.close();
  }
  private async observe(page: Page) {
    const original = await page.locator("body").innerText();
    return {
      url: page.url(),
      title: await page.title(),
      text: original.slice(0, this.policy.maxTextChars),
      truncated: original.length > this.policy.maxTextChars,
      observedAtUtc: new Date().toISOString(),
    };
  }
  private async withPage<T>(
    url: string,
    action: (page: Page) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolveQueue) => {
      release = resolveQueue;
    });
    await previous.catch(() => undefined);
    let stopping: Promise<void> | undefined;
    const abort = () => {
      stopping = this.close().catch(() => undefined);
    };
    try {
      signal?.throwIfAborted();
      this.validateUrl(url);
      await mkdir(this.profileRoot, { recursive: true });
      if (!this.context) {
        this.context = await chromium.launchPersistentContext(
          resolve(this.profileRoot, "dedicated"),
          {
            ...(this.executablePath
              ? { executablePath: this.executablePath }
              : {}),
            headless: this.policy.headless,
          },
        );
        this.context.setDefaultTimeout(30000);
        if (!this.policy.allowedDomains.includes("*"))
          await this.context.route("**/*", async (route) => {
            try {
              this.validateUrl(route.request().url());
              await route.continue();
            } catch {
              await route.abort();
            }
          });
        this.page = this.context.pages()[0] ?? (await this.context.newPage());
      }
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) {
        abort();
        signal.throwIfAborted();
      }
      const page = this.page!;
      // Preserve forms and navigation across multiple steps; do not reload the same URL on every action.
      if (page.url() !== url)
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      this.validateUrl(page.url());
      const result = await action(page);
      signal?.throwIfAborted();
      this.validateUrl(page.url());
      return result;
    } finally {
      signal?.removeEventListener("abort", abort);
      await stopping;
      release();
    }
  }
  private validateUrl(value: string): void {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new DomainError("POLICY_DENIED", "Invalid browser URL");
    }
    if (!["http:", "https:"].includes(url.protocol))
      throw new DomainError("POLICY_DENIED", "Browser URL must use HTTP(S)");
    if (
      !this.policy.allowedDomains.includes("*") &&
      !this.policy.allowedDomains.includes(url.hostname)
    )
      throw new DomainError(
        "POLICY_DENIED",
        "Browser domain outside configured policy",
      );
  }
}
function decodeXml(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replace(/<[^>]+>/gu, "")
    .trim();
}
