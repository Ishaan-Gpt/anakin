function toLabel(key) {
  return String(key)
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\w/, (char) => char.toUpperCase());
}

function stringifyValue(value) {
  if (value == null || value === "") {
    return "Not provided";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value, null, 2);
}

function isPrimitive(value) {
  return value == null || ["string", "number", "boolean"].includes(typeof value);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inferTitle(data) {
  if (Array.isArray(data)) {
    return data.length ? `Result set (${data.length})` : "Result";
  }

  if (typeof data === "string") {
    return "Generated output";
  }

  if (isRecord(data)) {
    return data.title || data.name || data.query || "Automation result";
  }

  return "Automation result";
}

function buildSummary(data) {
  if (typeof data === "string") {
    return data.length > 220 ? `${data.slice(0, 217)}...` : data;
  }

  if (Array.isArray(data)) {
    return data.length ? `${data.length} items returned.` : "No items were returned.";
  }

  if (isRecord(data)) {
    if (typeof data.summary === "string" && data.summary.trim()) {
      return data.summary.trim();
    }

    if (typeof data.one_liner === "string" && data.one_liner.trim()) {
      return data.one_liner.trim();
    }

    if (Array.isArray(data.companies)) {
      return `${data.companies.length} companies matched${data.query ? ` for "${data.query}"` : ""}.`;
    }

    const keys = Object.keys(data);
    return keys.length ? `Contains ${keys.length} fields.` : "No structured fields were returned.";
  }

  return "Completed successfully.";
}

function buildListSection(title, items) {
  return {
    kind: "list",
    title,
    items: items.map((item) => {
      if (typeof item === "string") {
        return { title: item, description: "" };
      }

      if (isRecord(item)) {
        const titleValue = item.title || item.name || item.label || item.url || "Item";
        const description = item.description || item.one_liner || item.summary || "";
        const meta = Object.entries(item)
          .filter(([key, value]) => !["title", "name", "label", "description", "one_liner", "summary"].includes(key) && isPrimitive(value))
          .slice(0, 5)
          .map(([key, value]) => ({
            label: toLabel(key),
            value: stringifyValue(value),
          }));

        return {
          title: stringifyValue(titleValue),
          description: description ? stringifyValue(description) : "",
          meta,
        };
      }

      return { title: stringifyValue(item), description: "" };
    }),
  };
}

function buildKeyValueSection(title, record) {
  return {
    kind: "keyValue",
    title,
    entries: Object.entries(record).map(([key, value]) => ({
      label: toLabel(key),
      value: stringifyValue(value),
    })),
  };
}

function buildSections(data) {
  if (typeof data === "string") {
    return [{ kind: "text", title: "Details", body: data }];
  }

  if (Array.isArray(data)) {
    return data.length ? [buildListSection("Items", data)] : [];
  }

  if (!isRecord(data)) {
    return [{ kind: "text", title: "Value", body: stringifyValue(data) }];
  }

  const sections = [];

  if (Array.isArray(data.companies)) {
    const overview = {
      query: data.query,
      totalHits: data.total_hits,
      shown: data.companies.length,
    };
    sections.push(buildKeyValueSection("Overview", overview));
    sections.push(buildListSection("Companies", data.companies));
    return sections;
  }

  const primitiveEntries = {};
  const arrayEntries = [];
  const objectEntries = [];

  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      arrayEntries.push([key, value]);
      continue;
    }

    if (isRecord(value)) {
      objectEntries.push([key, value]);
      continue;
    }

    primitiveEntries[key] = value;
  }

  if (Object.keys(primitiveEntries).length) {
    sections.push(buildKeyValueSection("Overview", primitiveEntries));
  }

  for (const [key, value] of arrayEntries) {
    sections.push(buildListSection(toLabel(key), value));
  }

  for (const [key, value] of objectEntries) {
    sections.push(buildKeyValueSection(toLabel(key), value));
  }

  if (!sections.length) {
    sections.push({ kind: "text", title: "Details", body: stringifyValue(data) });
  }

  return sections;
}

export function presentAutomationResult(result, meta = {}) {
  return {
    title: inferTitle(result),
    summary: buildSummary(result),
    sections: buildSections(result),
    meta: {
      mode: meta.mode || "browser",
      executionMs: meta.executionMs || 0,
      creditsUsed: meta.creditsUsed || 0,
    },
    raw: result,
  };
}
