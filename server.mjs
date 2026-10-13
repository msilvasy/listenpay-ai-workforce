import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extname, join } from "node:path";

function loadEnvFile() {
  const envPath = fileURLToPath(new URL("./.env", import.meta.url));
  try {
    const contents = readFileSync(envPath, "utf8");
    for (const rawLine of contents.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue;
      const value = rawValue.replace(/^(["'])(.*)\1$/, "$2").replace(/\\n/g, "\n");
      process.env[key] = value;
    }
  } catch (error) {
    if (error && error.code !== "ENOENT") console.warn("Unable to load .env:", error.message);
  }
}

loadEnvFile();

// Built Angular output. `ng build` places the browser bundle either directly in
// dist/listenpay-angular or, on newer CLI versions, in dist/listenpay-angular/browser.
const distRoot = fileURLToPath(new URL("./dist/listenpay-angular", import.meta.url));
const distBrowser = fileURLToPath(new URL("./dist/listenpay-angular/browser", import.meta.url));

async function resolveStaticRoot() {
  try {
    const info = await stat(join(distBrowser, "index.html"));
    if (info.isFile()) return distBrowser;
  } catch {
    /* fall through */
  }
  return distRoot;
}

const staticRoot = await resolveStaticRoot();
const indexPath = join(staticRoot, "index.html");

const port = Number.parseInt(process.env.PORT || "3000", 10);
const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

const guidanceInstructions = `You are ListenPay Guidance AI. Create educational workforce training and compliance-planning guidance, not legal advice and not a compliance determination. Respond only with JSON using exactly these fields: priority (string), firstStep (string), modules (array of exactly 3 concise strings), compliance (string), note (string). Make the guidance specific to the selected program and the request context. The note must state that the guidance should be validated against approved organizational policies and compliance resources.`;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

async function readRequestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16_000) throw new Error("Request body exceeds the 16 KB limit.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function isGuidance(value) {
  return Boolean(
    value &&
      typeof value.priority === "string" &&
      typeof value.firstStep === "string" &&
      Array.isArray(value.modules) &&
      value.modules.length === 3 &&
      value.modules.every((item) => typeof item === "string") &&
      typeof value.compliance === "string" &&
      typeof value.note === "string"
  );
}

async function generateRecommendation(request, response) {
  if (!process.env.OPENAI_API_KEY) {
    sendJson(response, 503, {
      error: "Live recommendations are not configured. Set OPENAI_API_KEY before starting the server.",
    });
    return;
  }

  try {
    const body = await readRequestBody(request);
    const program = typeof body.program === "string" ? body.program.trim() : "";
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!program || prompt.length < 12 || prompt.length > 8_000) {
      sendJson(response, 400, { error: "Provide a program and 12–8,000 characters of planning context." });
      return;
    }

    const openAiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.35,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: guidanceInstructions },
          { role: "user", content: `Program: ${program}\n\nPlanning context: ${prompt}` },
        ],
      }),
    });

    if (!openAiResponse.ok) {
      console.error("OpenAI request failed:", openAiResponse.status);
      const isQuotaOrRateLimit = openAiResponse.status === 429;
      sendJson(response, isQuotaOrRateLimit ? 429 : 502, {
        error: isQuotaOrRateLimit
          ? "The AI provider has reached a rate or quota limit. Check your OpenAI project billing and try again."
          : "The live recommendation service is temporarily unavailable. Please try again.",
      });
      return;
    }

    const completion = await openAiResponse.json();
    const content = completion?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("OpenAI returned no recommendation content.");

    const guidance = JSON.parse(content);
    if (!isGuidance(guidance)) throw new Error("OpenAI returned an invalid recommendation shape.");

    sendJson(response, 200, { guidance });
  } catch (error) {
    console.error("Recommendation generation failed:", error instanceof Error ? error.message : error);
    sendJson(response, 500, { error: "The live recommendation could not be generated. Please revise the request and try again." });
  }
}

async function serveStatic(request, response, pathname) {
  // Never serve anything outside the build output directory.
  const safePath = join(staticRoot, pathname).startsWith(staticRoot) ? join(staticRoot, pathname) : staticRoot;
  const candidates = pathname === "/" ? [indexPath] : [safePath, indexPath];

  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (!info.isFile()) continue;
      const content = await readFile(candidate);
      const type = MIME_TYPES[extname(candidate)] || "application/octet-stream";
      response.writeHead(200, {
        "Content-Type": type,
        // The Angular router owns index.html; never let it get cached.
        "Cache-Control": candidate === indexPath ? "no-store" : "public, max-age=3600",
      });
      if (request.method !== "HEAD") response.end(content);
      else response.end();
      return;
    } catch {
      continue;
    }
  }

  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Not found");
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  if (request.method === "POST" && url.pathname === "/api/recommendation") {
    await generateRecommendation(request, response);
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD, POST", "Content-Type": "text/plain; charset=utf-8" });
    response.end("Method not allowed");
    return;
  }

  // All non-API GET/HEAD requests are handled by static file serving, falling back
  // to index.html so the Angular router can handle client-side routes (deep links
  // like /workspace, /programs, /legal).
  await serveStatic(request, response, url.pathname);
});

server.listen(port, () => {
  console.log(`ListenPay Angular app is running at http://localhost:${port}`);
  if (staticRoot === distRoot) {
    console.log("Note: serving from dist/listenpay-angular (no /browser subfolder found).");
  }
});
