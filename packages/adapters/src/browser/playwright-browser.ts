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
  constructor(
    private readonly executablePath: string,
    private readonly profileRoot: string,
    private readonly policy: BrowserPolicy,
  ) {}

  async inspect(url: string): Promise<{
    readonly url: string;
    readonly title: string;
    readonly text: string;
  }> {
    return this.withPage(url, async (page) => ({
      url: page.url(),
      title: await page.title(),
      text: (await page.locator("body").innerText()).slice(
        0,
        this.policy.maxTextChars,
      ),
    }));
  }

  async search(query: string): Promise<{
    readonly url: string;
    readonly title: string;
    readonly observedAtUtc: string;
    readonly items: readonly {
      readonly title: string;
      readonly url: string;
      readonly description: string;
    }[];
    readonly text: string;
  }> {
    if (query.trim().length < 1 || query.length > 512)
      throw new DomainError("INVALID_OUTPUT", "Search query is invalid");
    const url = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`;
    let response: Response | undefined;
    let transportFailure: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        response = await fetch(url, {
          headers: { "user-agent": "Mozilla/5.0 Synlet/1.0" },
          signal: AbortSignal.timeout(20_000),
        });
        if (response.ok || response.status < 500) break;
      } catch (error: unknown) {
        transportFailure = error;
      }
      if (attempt < 3)
        await new Promise((resolveDelay) =>
          setTimeout(resolveDelay, 250 * attempt),
        );
    }
    if (!response)
      throw new DomainError(
        "CAPABILITY_UNAVAILABLE",
        `Search transport failed after retries: ${transportFailure instanceof Error ? transportFailure.message : "unknown network error"}`,
      );
    if (!response.ok)
      throw new DomainError(
        "CAPABILITY_UNAVAILABLE",
        `Search provider returned HTTP ${response.status}`,
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
    if (items.length === 0)
      throw new DomainError(
        "INVALID_OUTPUT",
        "Search provider returned no results",
      );
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
        .join("\n\n")
        .slice(0, this.policy.maxTextChars),
    };
  }

  async clickAndObserve(
    url: string,
    role: "button" | "link",
    name: string,
  ): Promise<{
    readonly url: string;
    readonly title: string;
    readonly text: string;
  }> {
    if (name.length < 1 || name.length > 256)
      throw new DomainError("INVALID_OUTPUT", "Invalid accessible name");
    return this.withPage(url, async (page) => {
      await page.getByRole(role, { name, exact: true }).click();
      await page.waitForLoadState("domcontentloaded");
      return {
        url: page.url(),
        title: await page.title(),
        text: (await page.locator("body").innerText()).slice(
          0,
          this.policy.maxTextChars,
        ),
      };
    });
  }

  async typeAndObserve(
    url: string,
    label: string,
    value: string,
    submit: boolean,
  ): Promise<{
    readonly url: string;
    readonly title: string;
    readonly text: string;
  }> {
    if (label.length < 1 || label.length > 256 || value.length > 16_384)
      throw new DomainError("INVALID_OUTPUT", "Invalid browser input");
    return this.withPage(url, async (page) => {
      const textbox = page.getByRole("textbox", { name: label, exact: true });
      await textbox.fill(value);
      if (submit) {
        await textbox.press("Enter");
        await page.waitForLoadState("domcontentloaded").catch(() => undefined);
      }
      return {
        url: page.url(),
        title: await page.title(),
        text: `${await page.locator("body").innerText()}\n\n[Filled textbox: ${label} = ${value}]`.slice(
          0,
          this.policy.maxTextChars,
        ),
      };
    });
  }

  private async withPage<T>(
    url: string,
    action: (page: Page) => Promise<T>,
  ): Promise<T> {
    this.validateUrl(url);
    await mkdir(this.profileRoot, { recursive: true });
    let context: BrowserContext | undefined;
    try {
      context = await chromium.launchPersistentContext(
        resolve(this.profileRoot, "dedicated"),
        {
          executablePath: this.executablePath,
          headless: this.policy.headless,
        },
      );
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(url, { waitUntil: "commit", timeout: 30_000 });
      await page
        .locator("body")
        .waitFor({ state: "attached", timeout: 15_000 });
      this.validateUrl(page.url());
      return await action(page);
    } finally {
      await context?.close();
    }
  }

  private validateUrl(value: string): void {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new DomainError("POLICY_DENIED", "Browser URL is invalid");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new DomainError("POLICY_DENIED", "Browser protocol is not allowed");
    }
    if (
      !this.policy.allowedDomains.includes("*") &&
      !this.policy.allowedDomains.includes(url.hostname)
    ) {
      throw new DomainError(
        "POLICY_DENIED",
        "Browser domain is outside policy",
      );
    }
  }
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replace(/<[^>]+>/gu, "")
    .trim();
}
