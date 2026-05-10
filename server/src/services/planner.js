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

function extractFirstUrl(text) {
  const match = text.match(/https?:\/\/[^\s)"]+/i);
  return match ? match[0] : "";
}

function extractCrossMatchQuery(text) {
  const quotedMatch = text.match(/cross match against\s*:\s*"([^"]+)"/i);
  if (quotedMatch) {
    return quotedMatch[1].trim();
  }

  const lineMatch = text.match(/cross match against\s*:\s*([^\n]+)/i);
  if (lineMatch) {
    return lineMatch[1].replace(/^["']|["']$/g, "").trim();
  }

  return "";
}

function buildFacultyOutreachPlan(name, steps) {
  const startUrl = extractFirstUrl(steps) || "https://example.com";
  const researchQuery = extractCrossMatchQuery(steps);

  return {
    mode: "browser",
    routeReason:
      "This is a custom faculty-research extraction and ranking task, so Browser API is the correct route.",
    requiresSession: false,
    sessionKind: "none",
    paramFields: [
      {
        name: "target_url",
        label: "Target URL",
        required: true,
        placeholder: startUrl,
      },
      {
        name: "query",
        label: "Research query",
        required: true,
        placeholder: researchQuery || "multimodal LLMs and robotics",
      },
    ],
    wire: null,
    browser: {
      startUrl,
      resultShape: "json",
      script: `const startUrl = params.target_url || ${JSON.stringify(startUrl)};
const researchQuery = (params.query || ${JSON.stringify(researchQuery)}).trim();
const queryTerms = researchQuery
  .toLowerCase()
  .split(/[^a-z0-9+]+/)
  .map((term) => term.trim())
  .filter((term) => term.length > 2);

function scoreText(text) {
  const lower = String(text || '').toLowerCase();
  let score = 0;
  for (const term of queryTerms) {
    if (lower.includes(term)) {
      score += term.length > 6 ? 3 : 2;
    }
  }
  if (lower.includes('multimodal')) score += 4;
  if (lower.includes('llm') || lower.includes('large language model')) score += 4;
  if (lower.includes('robotics') || lower.includes('robot')) score += 4;
  return score;
}

function extractEmails(text) {
  return Array.from(new Set((String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/gi) || [])));
}

async function collectListingLinks() {
  await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  return await page.$$eval('a[href]', (anchors, origin) => {
    return Array.from(new Set(anchors.map((anchor) => {
      const href = anchor.getAttribute('href') || '';
      const text = (anchor.textContent || '').trim();
      try {
        const absolute = new URL(href, origin).toString();
        return JSON.stringify({ href: absolute, text });
      } catch {
        return '';
      }
    }).filter(Boolean))).map((entry) => JSON.parse(entry)).filter((entry) => {
      const href = entry.href.toLowerCase();
      const text = entry.text.toLowerCase();
      return (
        href.startsWith(new URL(origin).origin) &&
        (
          href.includes('/faculty') ||
          href.includes('/people') ||
          href.includes('/person') ||
          text.includes('prof') ||
          text.includes('faculty')
        )
      );
    });
  }, startUrl);
}

async function extractProfile(url, fallbackName) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  return await page.evaluate(({ fallbackName, researchQuery }) => {
    const titleCandidates = [
      document.querySelector('h1'),
      document.querySelector('h2'),
      document.querySelector('.page-title'),
      document.querySelector('.title'),
      document.querySelector('.name'),
    ].filter(Boolean);

    const fullText = document.body ? document.body.innerText.replace(/\\s+/g, ' ').trim() : '';
    const pageText = fullText.slice(0, 8000);
    const emailMatches = Array.from(new Set((document.body?.innerHTML.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/gi) || [])));
    const mailtoLinks = Array.from(document.querySelectorAll('a[href^="mailto:"]'))
      .map((anchor) => anchor.getAttribute('href')?.replace(/^mailto:/i, '').trim())
      .filter(Boolean);
    const emails = Array.from(new Set([...emailMatches, ...mailtoLinks]));

    const lines = (document.body?.innerText || '')
      .split('\\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const researchLines = lines.filter((line) => /research|interest|area|speciali[sz]ation/i.test(line)).slice(0, 12);
    const researchInterests = researchLines.join(' | ') || pageText.slice(0, 1000);
    const professorName = titleCandidates[0]?.textContent?.trim() || fallbackName || document.title || 'Unknown Professor';

    return {
      professorName,
      emails,
      researchInterests,
      pageText,
      pageUrl: window.location.href,
      researchQuery,
    };
  }, { fallbackName, researchQuery });
}

const listingLinks = await collectListingLinks();
const profileLinks = listingLinks.slice(0, 30);
const professors = [];

for (const link of profileLinks) {
  try {
    const profile = await extractProfile(link.href, link.text);
    const researchText = [profile.researchInterests, profile.pageText].join(' ');
    const matchScore = scoreText(researchText);
    professors.push({
      professor_name: profile.professorName,
      email: profile.emails[0] || '',
      research_interests: profile.researchInterests,
      research_match_score: matchScore,
      source_url: profile.pageUrl,
      draft_email:
        'Subject: Potential research collaboration\\n\\nDear ' +
        profile.professorName +
        ',\\n\\nI came across your work and was especially interested in ' +
        (profile.researchInterests.slice(0, 220) || 'your recent research.') +
        ' My work focuses on ' +
        researchQuery +
        ', and I believe there may be meaningful overlap between our interests. I would value the chance to briefly connect and learn whether there may be a fit for collaboration or research discussion.\\n\\nBest regards,\\n[Your Name]',
    });
  } catch {}
}

professors.sort((left, right) => right.research_match_score - left.research_match_score);

return {
  success: true,
  data: professors.slice(0, 5),
};`,
    },
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
      routeReason: "This flow expects a manually created saved browser session, then reuses that authenticated state at runtime.",
      requiresSession: true,
      sessionKind: "browser_session",
      paramFields: [],
      wire: null,
      browser: {
        startUrl: "https://quotes.toscrape.com/login",
        resultShape: "json",
        script: `await page.goto('https://quotes.toscrape.com/login', { waitUntil: 'domcontentloaded' });
const logoutLink = await page.$('a[href="/logout"]');
const loginForm = await page.$('input[name="username"]');
if (!logoutLink && loginForm) {
  throw new Error('Selected browser session is not authenticated for this site. Create the session manually first, then rerun.');
}
return {
  success: true,
  data: {
    url: page.url(),
    title: await page.title(),
    authenticated: Boolean(logoutLink),
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

  if (
    text.includes("faculty") &&
    text.includes("research") &&
    (text.includes("cold email") || text.includes("draft email") || text.includes("rank by relevance"))
  ) {
    return buildFacultyOutreachPlan(name, steps);
  }

  return null;
}

function buildGenericBrowserFallbackPlan(name, steps, reason) {
  return {
    mode: "browser",
    routeReason:
      reason ||
      "Falling back to a generic Browser API plan so the automation can still be prepared.",
    requiresSession: false,
    sessionKind: "none",
    paramFields: [
      {
        name: "target_url",
        label: "Target URL",
        required: true,
        placeholder: "https://example.com",
      },
    ],
    wire: null,
    browser: {
      startUrl: "https://example.com",
      resultShape: "json",
      script: `await page.goto(params.target_url || 'https://example.com', { waitUntil: 'domcontentloaded' });
return {
  success: true,
  data: {
    name: ${JSON.stringify(name)},
    url: page.url(),
    title: await page.title(),
    summary: ${JSON.stringify(steps)},
  },
};`,
    },
  };
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

  let candidates = [];
  try {
    const searchResponse = await searchActions(anakinApiKey, `${input.name} ${input.steps}`);
    candidates = toActionCandidates(searchResponse);
  } catch {
    candidates = [];
  }

  let planned;
  try {
    planned = await planAutomation({
      apiKey: geminiApiKey,
      model,
      name: input.name,
      steps: input.steps,
      actionCandidates: candidates,
    });
  } catch {
    return ensurePlanFields(
      buildGenericBrowserFallbackPlan(
        input.name,
        input.steps,
        "Planner service could not produce a structured route, so AutoFlow prepared a generic Browser API automation instead.",
      ),
      input.name,
      input.steps,
    );
  }

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
