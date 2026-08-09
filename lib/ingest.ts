import crypto from "crypto";
import { getDb } from "./db";
import { logEvent } from "./bus";

export interface RawArticle {
  sourceId: string;
  title: string;
  summary: string;
  content: string;
  url: string;
  author: string | null;
  imageUrl: string | null;
  publishedAt: number;
  language: string;
}

const STOPWORDS = new Set(("a,an,the,and,or,but,if,then,else,when,at,from,by,for,with,about,against,between,into,through,during,before,after,above,below,to,of,in,on,off,over,under,again,further,once,here,there,all,any,both,each,few,more,most,other,some,such,no,nor,not,only,own,same,so,than,too,very,can,will,just,should,now,is,are,was,were,be,been,being,have,has,had,having,do,does,did,doing,would,could,ought,i,you,he,she,it,we,they,them,his,her,its,our,their,this,that,these,those,am,as,us,what,which,who,whom,how,why,said,says,say,new,after,before,also,one,two,first,last,year,day,week,month,time,today,yesterday,people,says,u,k,like,get,got,make,made,according,report,reports,reportedly,latest,breaking,live,update,updates,video,watch,photos,images,analysis,explainer").split(","));

export function tokenize(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-zà-ÿ0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  const counts = new Map<string, number>();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 24)
    .map(([w]) => w);
}

// ---------- Ultra-light RSS/Atom parser (no dependency) ----------
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeEntities(m[1].trim()) : null;
}

function attr(block: string, tagName: string, attrName: string): string | null {
  const m = block.match(new RegExp(`<${tagName}[^>]*\\s${attrName}=["']([^"']+)["']`, "i"));
  return m ? m[1] : null;
}

function parseDate(s: string | null): number {
  if (!s) return Date.now();
  const t = Date.parse(s);
  return isNaN(t) ? Date.now() : t;
}

export function parseFeed(xml: string, sourceId: string): RawArticle[] {
  const out: RawArticle[] = [];
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  for (const item of items.slice(0, 40)) {
    const title = tag(item, "title");
    let link = tag(item, "link") ?? attr(item, "link", "href") ?? tag(item, "guid") ?? "";
    link = link.trim();
    if (!title || !link || !/^https?:/i.test(link)) continue;
    const desc = tag(item, "description") ?? tag(item, "summary") ?? tag(item, "content") ?? tag(item, "content:encoded") ?? "";
    const content = stripTags(tag(item, "content:encoded") ?? desc);
    const pubDate = tag(item, "pubDate") ?? tag(item, "published") ?? tag(item, "updated") ?? tag(item, "dc:date");
    const author = tag(item, "author") ?? tag(item, "dc:creator") ?? attr(item, "name", "") ?? null;
    const media = attr(item, "media:content", "url") ?? attr(item, "media:thumbnail", "url") ?? attr(item, "enclosure url", "") ?? null;
    const enclosure = item.match(/<enclosure[^>]*url=["']([^"']+)["'][^>]*type=["']image/i)?.[1] ?? null;
    out.push({
      sourceId,
      title: stripTags(title).slice(0, 300),
      summary: stripTags(desc).slice(0, 1200),
      content: content.slice(0, 6000),
      url: link,
      author: author ? stripTags(String(author)).slice(0, 120) : null,
      imageUrl: media ?? enclosure,
      publishedAt: parseDate(pubDate),
      language: "en",
    });
  }
  return out;
}

/** Heuristic filters for sponsored/affiliate/evergreen-junk items that ride inside news RSS feeds. */
const BAD_HOSTS = [/fool\.com\/the-ascent/i, /lendingtree\.com/i, /\/deals?\//i, /\/shop(?:ping)?\//i, /\/coupons?\//i, /\/reviews?\/best-/i];
const BAD_TITLE = [/cash back card/i, /home equity/i, /intro apr/i, /credit cards? (of|for) 20\d\d/i, /best (cd|savings|mortgage) rates/i, /sign-?up bonus/i, /^\[?(sponsored|paid post|partner content)\]?/i, /gift guide/i, /things to watch on/i];

export function isJunkArticle(a: { title: string; url: string }): boolean {
  if (BAD_HOSTS.some((re) => re.test(a.url))) return true;
  if (BAD_TITLE.some((re) => re.test(a.title))) return true;
  return false;
}

export async function fetchSource(sourceId: string, url: string): Promise<{ added: number; total: number; error?: string }> {
  const db = getDb();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "NewscastAI/1.0 (+https://newscast.ai) RSS Reader", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const articles = parseFeed(xml, sourceId).filter((a) => !isJunkArticle(a));
    const insert = db.prepare(`
      INSERT INTO articles (id, source_id, title, summary, content, url, author, image_url, published_at, fetched_at, language, tokens)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(url) DO UPDATE SET
        title=excluded.title, summary=excluded.summary, content=excluded.content,
        image_url=COALESCE(excluded.image_url, articles.image_url),
        tokens=excluded.tokens
    `);
    let added = 0;
    const tx = db.transaction(() => {
      for (const a of articles) {
        const id = crypto.createHash("sha1").update(a.url).digest("hex").slice(0, 16);
        const tokens = JSON.stringify(tokenize(a.title + " " + a.summary));
        const changed = insert.run(id, a.sourceId, a.title, a.summary, a.content, a.url, a.author, a.imageUrl, a.publishedAt, Date.now(), a.language, tokens);
        if (changed.changes > 0) added++;
      }
    });
    tx();
    return { added, total: articles.length };
  } catch (e) {
    return { added: 0, total: 0, error: String(e) };
  }
}

export async function fetchAllSources(): Promise<{ source: string; added: number; total: number; error?: string }[]> {
  const db = getDb();
  const sources = db.prepare("SELECT id, url FROM sources WHERE enabled=1").all() as { id: string; url: string }[];
  logEvent("ingest", `Fetching ${sources.length} sources`);
  const results = await Promise.all(sources.map((s) => fetchSource(s.id, s.url).then((r) => ({ source: s.id, ...r }))));
  return results;
}
