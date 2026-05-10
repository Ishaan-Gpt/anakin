import { chromium } from "playwright-core";

const DEMOS = [
  {
    id: "hackernews-top",
    name: "Hacker News Top Stories",
    description: "Scrape the top 5 stories from Hacker News with scores and discussion links.",
    icon: "📰",
    estimatedSeconds: 15,
    authRequired: false,
  },
  {
    id: "github-trending",
    name: "GitHub Trending Repos",
    description: "Extract today's trending repositories from GitHub with stars and descriptions.",
    icon: "⭐",
    estimatedSeconds: 20,
    authRequired: false,
  },
  {
    id: "wikipedia-random",
    name: "Wikipedia Random Article",
    description: "Navigate to a random Wikipedia article and capture its title and summary.",
    icon: "📚",
    estimatedSeconds: 12,
    authRequired: false,
  },
];

export function listBrowserDemos() {
  return DEMOS;
}

function buildConnectUrl() {
  const url = new URL("wss://api.anakin.io/v1/browser-connect");
  const country = process.env.ANAKIN_BROWSER_COUNTRY || "US";
  if (country) url.searchParams.set("country", country);
  return url.toString();
}

async function snap(page, title, description, extra) {
  const buffer = await page.screenshot({ type: "jpeg", quality: 65 });
  return {
    title,
    description,
    screenshot: `data:image/jpeg;base64,${buffer.toString("base64")}`,
    timestamp: Date.now(),
    ...(extra || {}),
  };
}

async function demoHackerNews(browser) {
  const steps = [];
  const context = browser.contexts()[0] || (await browser.newContext());
  const page = context.pages()[0] || (await context.newPage());
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.goto("https://news.ycombinator.com", { waitUntil: "domcontentloaded", timeout: 25000 });
  await page.waitForSelector(".titleline", { timeout: 10000 });
  steps.push(await snap(page, "Loaded Hacker News", "Navigated to the HN front page and waited for stories to render."));

  const stories = await page.evaluate(() => {
    const rows = document.querySelectorAll(".athing");
    return Array.from(rows).slice(0, 5).map((row, i) => {
      const a = row.querySelector(".titleline > a");
      const meta = row.nextElementSibling;
      const score = meta?.querySelector(".score");
      const age = meta?.querySelector(".age a");
      return {
        rank: i + 1,
        title: a?.textContent || "",
        url: a?.href || "",
        score: score?.textContent || "0 points",
        age: age?.textContent || "",
      };
    });
  });

  steps.push(await snap(page, "Extracted Top 5 Stories", `Parsed ${stories.length} stories with titles, URLs, and scores.`, { data: stories }));

  if (stories[0]?.url) {
    await page.goto(stories[0].url, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
    steps.push(await snap(page, "Visited Top Story", `Opened: ${stories[0].title}`));
  }

  return { steps, result: { stories }, demoId: "hackernews-top" };
}

async function demoGithubTrending(browser) {
  const steps = [];
  const context = browser.contexts()[0] || (await browser.newContext());
  const page = context.pages()[0] || (await context.newPage());
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.goto("https://github.com/trending", { waitUntil: "domcontentloaded", timeout: 25000 });
  await page.waitForSelector("article.Box-row", { timeout: 10000 }).catch(() => {});
  steps.push(await snap(page, "Loaded GitHub Trending", "Navigated to github.com/trending and waited for the repo list."));

  const repos = await page.evaluate(() => {
    const articles = document.querySelectorAll("article.Box-row");
    return Array.from(articles).slice(0, 5).map((el, i) => {
      const nameEl = el.querySelector("h2 a");
      const descEl = el.querySelector("p");
      const langEl = el.querySelector("[itemprop='programmingLanguage']");
      const starsEl = el.querySelector("a[href*='/stargazers']");
      const todayEl = el.querySelector("span.d-inline-block.float-sm-right");
      return {
        rank: i + 1,
        name: nameEl?.textContent?.trim().replace(/\s+/g, "") || "",
        url: nameEl ? `https://github.com${nameEl.getAttribute("href")}` : "",
        description: descEl?.textContent?.trim() || "",
        language: langEl?.textContent?.trim() || "",
        stars: starsEl?.textContent?.trim() || "",
        todayStars: todayEl?.textContent?.trim() || "",
      };
    });
  });

  steps.push(await snap(page, "Extracted Trending Repos", `Found ${repos.length} trending repositories.`, { data: repos }));

  if (repos[0]?.url) {
    await page.goto(repos[0].url, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
    steps.push(await snap(page, "Visited Top Repo", `Opened: ${repos[0].name}`));
  }

  return { steps, result: { repos }, demoId: "github-trending" };
}

async function demoWikipediaRandom(browser) {
  const steps = [];
  const context = browser.contexts()[0] || (await browser.newContext());
  const page = context.pages()[0] || (await context.newPage());
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.goto("https://en.wikipedia.org/wiki/Special:Random", { waitUntil: "domcontentloaded", timeout: 25000 });
  await page.waitForSelector("#firstHeading", { timeout: 10000 });
  steps.push(await snap(page, "Loaded Random Article", "Navigated to a random Wikipedia article."));

  const article = await page.evaluate(() => {
    const title = document.getElementById("firstHeading")?.textContent || "";
    const paragraphs = document.querySelectorAll("#mw-content-text .mw-parser-output > p");
    let summary = "";
    for (const p of paragraphs) {
      const text = p.textContent?.trim();
      if (text && text.length > 40) {
        summary = text;
        break;
      }
    }
    const categories = Array.from(document.querySelectorAll("#mw-normal-catlinks ul li a"))
      .slice(0, 5)
      .map((a) => a.textContent);
    return { title, summary, url: window.location.href, categories };
  });

  steps.push(await snap(page, "Extracted Article Data", `Title: ${article.title}`, { data: article }));

  await page.evaluate(() => window.scrollTo(0, 600));
  await new Promise((r) => setTimeout(r, 500));
  steps.push(await snap(page, "Scrolled Article Body", "Captured the article body below the fold."));

  return { steps, result: article, demoId: "wikipedia-random" };
}

const RUNNERS = {
  "hackernews-top": demoHackerNews,
  "github-trending": demoGithubTrending,
  "wikipedia-random": demoWikipediaRandom,
};

export async function runBrowserDemo(apiKey, demoId) {
  const runner = RUNNERS[demoId];
  if (!runner) throw new Error(`Unknown demo: ${demoId}`);

  const browser = await chromium.connectOverCDP(buildConnectUrl(), {
    headers: { "X-API-Key": apiKey },
    timeout: 30000,
  });

  try {
    return await runner(browser);
  } finally {
    await browser.close();
  }
}
