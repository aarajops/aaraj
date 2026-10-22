const configuredOrigin = process.argv[2];
let origin;

try {
  origin = new URL(configuredOrigin);
} catch {
  throw new Error(
    "Pass the public storefront HTTPS origin as the only argument.",
  );
}

if (
  origin.protocol !== "https:" ||
  origin.origin !== configuredOrigin ||
  origin.username ||
  origin.password
) {
  throw new Error(
    "The public storefront URL must be an HTTPS origin without a path.",
  );
}

const failures = [];

try {
  const writeProbe = await fetch(new URL("/api/v1/quotes", origin), {
    method: "POST",
    redirect: "manual",
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json",
      origin: origin.origin,
    },
    // The empty quote input fails schema validation before the handler writes.
    body: "{}",
    signal: AbortSignal.timeout(10000),
  });
  if (writeProbe.status !== 400) {
    failures.push(
      `canonical-origin write probe returned HTTP ${writeProbe.status}, expected HTTP 400 validation failure`,
    );
  }
} catch (error) {
  failures.push(`canonical-origin write probe failed: ${error.message}`);
}

const aliasOrigin = new URL(origin);
aliasOrigin.hostname = aliasOrigin.hostname.startsWith("www.")
  ? aliasOrigin.hostname.slice(4)
  : `www.${aliasOrigin.hostname}`;
try {
  const aliasResponse = await fetch(new URL("/", aliasOrigin), {
    redirect: "manual",
    headers: { "cache-control": "no-cache" },
    signal: AbortSignal.timeout(10000),
  });
  const location = aliasResponse.headers.get("location");
  const destination = location ? new URL(location, aliasOrigin) : null;
  if (
    aliasResponse.status !== 301 ||
    !destination ||
    destination.origin !== origin.origin ||
    destination.pathname !== "/"
  ) {
    failures.push(
      `www alias did not redirect to the canonical HTTPS origin (HTTP ${aliasResponse.status})`,
    );
  }
} catch (error) {
  failures.push(`www alias redirect check failed: ${error.message}`);
}

async function get(path) {
  try {
    const response = await fetch(new URL(path, origin), {
      headers: { "cache-control": "no-cache" },
      signal: AbortSignal.timeout(10000),
    });
    return { response, body: await response.text() };
  } catch (error) {
    failures.push(`${path} request failed: ${error.message}`);
    return null;
  }
}

const home = await get("/");
if (home) {
  if (!home.response.ok) {
    failures.push(`storefront returned HTTP ${home.response.status}`);
  }
  if (!/<title>[^<]+<\/title>/i.test(home.body)) {
    failures.push("storefront title metadata is missing");
  }
  if (
    !home.body.includes('property="og:title"') ||
    !home.body.includes('property="og:image"') ||
    !home.body.includes('name="twitter:card"') ||
    !home.body.includes('name="twitter:image"')
  ) {
    failures.push("social sharing metadata is missing");
  }
  if (
    home.body.includes("data-dgst=") ||
    home.body.includes("Something went wrong")
  ) {
    failures.push("storefront HTML contains a server-render error");
  }
}

const robots = await get("/robots.txt");
if (
  robots &&
  (!robots.response.ok ||
    !robots.body.includes(`Sitemap: ${origin.origin}/sitemap.xml`))
) {
  failures.push(
    `robots.txt is unavailable or points to the wrong canonical origin (HTTP ${robots.response.status})`,
  );
}

const sitemap = await get("/sitemap.xml");
if (
  sitemap &&
  (!sitemap.response.ok ||
    !sitemap.body.includes(`<loc>${origin.origin}/</loc>`))
) {
  failures.push(
    `sitemap.xml is unavailable or points to the wrong canonical origin (HTTP ${sitemap.response.status})`,
  );
}

const manifest = await get("/manifest.webmanifest");
if (manifest) {
  try {
    const value = JSON.parse(manifest.body);
    const iconPaths = new Set((value.icons ?? []).map((icon) => icon.src));
    if (
      !manifest.response.ok ||
      !value.name ||
      !iconPaths.has("/icon/192") ||
      !iconPaths.has("/icon/512")
    ) {
      failures.push(
        `web manifest is invalid (HTTP ${manifest.response.status})`,
      );
    }
  } catch {
    failures.push(
      `web manifest is not valid JSON (HTTP ${manifest.response.status})`,
    );
  }
}

for (const path of ["/apple-icon", "/icon/64", "/icon/192", "/icon/512"]) {
  const result = await get(path);
  if (
    result &&
    (!result.response.ok ||
      !result.response.headers.get("content-type")?.includes("image/png"))
  ) {
    failures.push(
      `${path} did not return a PNG icon (HTTP ${result.response.status})`,
    );
  }
}

if (failures.length) {
  for (const failure of failures) {
    console.error(`Public storefront check failed: ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    "Public storefront, canonical-origin write handling, www redirect, SEO metadata, manifest, and generated icons are healthy.",
  );
}
