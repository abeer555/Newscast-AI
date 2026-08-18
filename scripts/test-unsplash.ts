import fs from "fs";
import path from "path";

for (const name of [".env.local", ".env"]) {
  const p = path.join(process.cwd(), name);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
}

async function testUnsplash() {
  const unsplashKey = process.env.UNSPLASH_ACCESS_KEY;
  console.log(`UNSPLASH_ACCESS_KEY loaded: ${unsplashKey ? "Yes (Starts with " + unsplashKey.substring(0, 4) + "...)" : "No"}`);

  if (!unsplashKey) {
    console.error("❌ UNSPLASH_ACCESS_KEY is missing from your .env file!");
    return;
  }

  const query = process.argv[2] || "breaking news";
  const count = 5;
  console.log(`\n🔍 Searching Unsplash for: "${query}" (requesting ${count} images)`);

  try {
    const res = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${count}&orientation=landscape`, {
      headers: { "Authorization": `Client-ID ${unsplashKey}` },
      signal: AbortSignal.timeout(10000)
    });

    if (res.ok) {
      const data = await res.json();
      const results = data.results || [];
      console.log(`\n✅ Unsplash API Success! Found ${results.length} images.`);
      
      results.forEach((r: any, i: number) => {
        console.log(`\n[Image ${i + 1}]`);
        console.log(`Description: ${r.description || r.alt_description || "N/A"}`);
        console.log(`URL: ${r.urls.raw}&w=1280&h=720&fit=crop`);
        console.log(`Photographer: ${r.user.name}`);
      });
    } else {
      console.error(`\n❌ Unsplash API failed with status: ${res.status}`);
      const text = await res.text();
      console.error(`Response: ${text}`);
    }
  } catch (err) {
    console.error("\n❌ Fetch error:", err);
  }
}

testUnsplash();
