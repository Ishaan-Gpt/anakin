import { z } from "zod";
import { planAutomation } from "./gemini.js";

const prepareInputSchema = z.object({
  name: z.string().min(1),
  steps: z.string().min(1),
});

function toActionCandidates(searchResponse = {}) {
  return (searchResponse.results || []).slice(0, 6).map((action) => ({
    actionId: action.action_id,
    catalogSlug: action.catalog_slug,
    catalogName: action.catalog_name,
    name: action.name,
    description: action.description,
    mode: action.mode,
    authRequired: action.auth_required,
    connected: action.connected,
    paramsSchema: action.params,
    credits: action.credits,
  }));
}

function pickMatchingAction(route, candidates) {
  return candidates.find(
    (candidate) =>
      candidate.actionId === route?.wire?.actionId &&
      candidate.catalogSlug === route?.wire?.catalogSlug,
  );
}

function ensurePlanFields(plan, name, steps) {
  const text = `${name} ${steps}`.toLowerCase();
  const fields = [...(plan.paramFields || [])];
  const hasField = (fieldName) => fields.some((field) => field.name === fieldName);

  if (!hasField("query") && /\b(search|find|lookup|look up|query|keyword)\b/.test(text)) {
    fields.push({
      name: "query",
      label: "Search query",
      required: true,
      placeholder: "What should this automation search for?",
    });
  }

  return {
    ...plan,
    paramFields: fields,
  };
}

function buildYcSearchPlan() {
  return {
    mode: "wire",
    routeReason: "Directly mapped to Anakin's supported Y Combinator Wire action.",
    requiresSession: false,
    sessionKind: "none",
    paramFields: [
      {
        name: "query",
        label: "Idea keyword",
        required: true,
        placeholder: "AI bookkeeping",
      },
    ],
    wire: {
      actionId: "yc_search_companies",
      catalogSlug: "ycombinator",
      authRequired: false,
      paramsSchema: {},
    },
    browser: null,
  };
}

function buildWaalaxyAuthPlan() {
  return {
    mode: "wire",
    routeReason: "Directly mapped to Waalaxy auth bootstrap so you can connect LinkedIn once and reuse the credential.",
    requiresSession: true,
    sessionKind: "identity_credential",
    allowAnonymousBootstrap: true,
    paramFields: [
      {
        name: "profile_url",
        label: "LinkedIn profile URL",
        required: true,
        placeholder: "https://www.linkedin.com/in/your-profile/",
      },
    ],
    wire: {
      actionId: "waalaxy_generate_auth",
      catalogSlug: "waalaxy",
      authRequired: true,
      paramsSchema: {},
    },
    browser: null,
  };
}

function buildBrowserExamplesPlan(name, steps) {
  const text = `${name} ${steps}`.toLowerCase();

  if (text.includes("hacker news") || text.includes("news.ycombinator.com")) {
    return {
      mode: "browser",
      routeReason: "This is a free-form extraction flow on Hacker News, so Browser API is the right execution path.",
      requiresSession: false,
      sessionKind: "none",
      paramFields: [],
      wire: null,
      browser: {
        startUrl: "https://news.ycombinator.com",
        resultShape: "json",
        script: `await page.goto('https://news.ycombinator.com', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('tr.athing');
return {
  success: true,
  data: await page.$$eval('tr.athing', (rows) =>
    rows.slice(0, 10).map((row) => {
      const titleEl = row.querySelector('.titleline > a');
      const scoreEl = row.nextElementSibling?.querySelector('.score');
      return {
        title: titleEl?.textContent?.trim() ?? '',
        url: titleEl?.getAttribute('href') ?? '',
        score: scoreEl?.textContent?.trim() ?? 'n/a',
      };
    }),
  ),
};`,
      },
    };
  }

  if (text.includes("github trending") || text.includes("trending repos")) {
    return {
      mode: "browser",
      routeReason: "GitHub Trending is better handled as a browser extraction task than as a structured Wire action.",
      requiresSession: false,
      sessionKind: "none",
      paramFields: [],
      wire: null,
      browser: {
        startUrl: "https://github.com/trending",
        resultShape: "json",
        script: `await page.goto('https://github.com/trending', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('article.Box-row');
return {
  success: true,
  data: await page.$$eval('article.Box-row', (cards) =>
    cards.slice(0, 8).map((card) => {
      const nameEl = card.querySelector('h2 a');
      const descEl = card.querySelector('p');
      const starsEl = card.querySelector('a[href$="/stargazers"]');
      const langEl = card.querySelector('[itemprop="programmingLanguage"]');
      return {
        name: nameEl?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
        description: descEl?.textContent?.trim() ?? '—',
        stars: starsEl?.textContent?.trim() ?? '0',
        language: langEl?.textContent?.trim() ?? 'unknown',
      };
    }),
  ),
};`,
      },
    };
  }

  if (text.includes("books.toscrape.com") || text.includes("books to scrape")) {
    return {
      mode: "browser",
      routeReason: "This is a straightforward browser scraping task, so Browser API is the correct route.",
      requiresSession: false,
      sessionKind: "none",
      paramFields: [],
      wire: null,
      browser: {
        startUrl: "https://books.toscrape.com",
        resultShape: "json",
        script: `await page.goto('https://books.toscrape.com', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('article.product_pod');
return {
  success: true,
  data: await page.$$eval('article.product_pod', (cards) =>
    cards.slice(0, 8).map((card) => ({
      title: card.querySelector('h3 a')?.getAttribute('title') ?? '',
      price: card.querySelector('.price_color')?.textContent?.trim() ?? '',
      rating: card.querySelector('p.star-rating')?.className.split(' ')[1] ?? '',
      inStock: card.querySelector('.availability')?.textContent?.trim() ?? '',
    })),
  ),
};`,
      },
    };
  }

  if (
    text.includes("quotes.toscrape.com/login") ||
    (text.includes("login") && text.includes("form")) ||
    text.includes("submit a form")
  ) {
    return {
      mode: "browser",
      routeReason: "Form fill and submit flows are custom browser automations, so Browser API is the right runtime.",
      requiresSession: false,
      sessionKind: "none",
      paramFields: [
        {
          name: "username",
          label: "Username",
          required: true,
          placeholder: "testuser",
        },
        {
          name: "password",
          label: "Password",
          required: true,
          placeholder: "testpass",
        },
      ],
      wire: null,
      browser: {
        startUrl: "https://quotes.toscrape.com/login",
        resultShape: "json",
        script: `await page.goto('https://quotes.toscrape.com/login', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('input[name="username"]');
await page.fill('input[name="username"]', params.username || '');
await page.fill('input[name="password"]', params.password || '');
await Promise.all([
  page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
  page.click('input[type="submit"]'),
]);
const logoutLink = await page.$('a[href="/logout"]');
return {
  success: true,
  data: {
    url: page.url(),
    title: await page.title(),
    loggedIn: Boolean(logoutLink),
  },
};`,
      },
    };
  }

  return null;
}

function detectDirectPlan(name, steps) {
  const text = `${name} ${steps}`.toLowerCase();

  if (
    text.includes("y combinator") ||
    text.includes("ycombinator") ||
    text.includes("yc validator") ||
    text.includes("yc companies")
  ) {
    return buildYcSearchPlan();
  }

  if (
    text.includes("waalaxy") ||
    text.includes("linkedin connect") ||
    text.includes("linkedin auth")
  ) {
    return buildWaalaxyAuthPlan();
  }

  const browserExamplePlan = buildBrowserExamplesPlan(name, steps);
  if (browserExamplePlan) {
    return browserExamplePlan;
  }

  return null;
}

export async function prepareAutomation({
  geminiApiKey,
  anakinApiKey,
  model,
  name,
  steps,
  searchActions,
}) {
  const input = prepareInputSchema.parse({ name, steps });
  const directPlan = detectDirectPlan(input.name, input.steps);
  if (directPlan) {
    return ensurePlanFields(directPlan, input.name, input.steps);
  }

  const searchResponse = await searchActions(anakinApiKey, `${input.name} ${input.steps}`);
  const candidates = toActionCandidates(searchResponse);
  const planned = await planAutomation({
    apiKey: geminiApiKey,
    model,
    name: input.name,
    steps: input.steps,
    actionCandidates: candidates,
  });

  if (planned.mode === "wire") {
    const matched = pickMatchingAction(planned, candidates);
    if (!matched) {
      planned.mode = "browser";
      planned.routeReason = "Gemini suggested Wire, but no matching action candidate was available. Falling back to Browser API.";
      planned.requiresSession = false;
      planned.sessionKind = "none";
      planned.wire = null;
      planned.browser = planned.browser || {
        startUrl: "https://example.com",
        resultShape: "text",
        script: "await page.goto('https://example.com', { waitUntil: 'domcontentloaded' }); return { success: true, data: await page.title() };",
      };
    } else {
      planned.requiresSession = matched.authRequired;
      planned.sessionKind = matched.authRequired ? "identity_credential" : "none";
      planned.wire = {
        actionId: matched.actionId,
        catalogSlug: matched.catalogSlug,
        authRequired: matched.authRequired,
        paramsSchema: matched.paramsSchema || {},
      };
      planned.browser = null;
    }
  }

  if (planned.mode === "browser") {
    planned.wire = null;
    if (!planned.browser?.script) {
      planned.browser = {
        startUrl: "https://example.com",
        resultShape: "json",
        script:
          "await page.goto(params.target_url || 'https://example.com', { waitUntil: 'domcontentloaded' });\nreturn { success: true, data: { title: await page.title(), url: page.url(), summary: 'Page loaded successfully.' } };",
      };
      planned.paramFields = [
        ...(planned.paramFields || []),
        {
          name: "target_url",
          label: "Target URL",
          required: true,
          placeholder: "https://example.com",
        },
      ].filter(
        (field, index, list) => list.findIndex((entry) => entry.name === field.name) === index,
      );
    }
  }

  return ensurePlanFields(planned, input.name, input.steps);
}
