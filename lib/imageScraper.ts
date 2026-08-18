/**
 * Smart Image Scraper & Validator
 * Fetches images from news articles, validates quality, and falls back to AI generation
 */
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import crypto from "crypto";
import { trackModelApi } from "./bus";
import { chatJson, LLM_MODELS } from "./chat";

const run = promisify(execFile);

export interface ImageSource {
  path: string;
  source: "article" | "ai_generated";
  article_url?: string;
  width?: number;
  height?: number;
  quality_score: number; // 0-100
}

interface ImageMetadata {
  width: number;
  height: number;
  format: string;
  size: number; // bytes
}

/**
 * Get image metadata using ffprobe
 */
async function getImageMetadata(filePath: string): Promise<ImageMetadata | null> {
  try {
    const { stdout } = await run("ffprobe", [
      "-v", "quiet",
      "-print_format", "json",
      "-show_streams",
      filePath
    ]);
    const data = JSON.parse(stdout);
    const stream = data.streams?.[0];
    if (!stream) return null;

    const stats = fs.statSync(filePath);
    return {
      width: parseInt(stream.width) || 0,
      height: parseInt(stream.height) || 0,
      format: stream.codec_name || "unknown",
      size: stats.size,
    };
  } catch {
    return null;
  }
}

/**
 * Calculate quality score for an image
 */
function calculateQualityScore(meta: ImageMetadata | null, minWidth = 800, minHeight = 600): number {
  if (!meta) return 0;

  let score = 100;

  // Resolution check
  if (meta.width < minWidth || meta.height < minHeight) {
    const widthRatio = meta.width / minWidth;
    const heightRatio = meta.height / minHeight;
    const resolutionPenalty = (1 - Math.min(widthRatio, heightRatio)) * 50;
    score -= resolutionPenalty;
  }

  // Size check (too small = low quality, too large = ok)
  if (meta.size < 10 * 1024) { // Less than 10KB
    score -= 40;
  } else if (meta.size < 50 * 1024) { // Less than 50KB
    score -= 20;
  }

  // Aspect ratio check (prefer 16:9 or close to it)
  const aspectRatio = meta.width / meta.height;
  const targetAspect = 16 / 9;
  const aspectDiff = Math.abs(aspectRatio - targetAspect);
  if (aspectDiff > 0.5) {
    score -= 15; // Weird aspect ratio
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Download an image from URL with validation
 */
async function downloadAndValidateImage(
  url: string,
  destPath: string,
  minQualityScore = 40
): Promise<{ success: boolean; qualityScore: number; metadata: ImageMetadata | null }> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return { success: false, qualityScore: 0, metadata: null };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(destPath, buffer);

    // Validate image
    const metadata = await getImageMetadata(destPath);
    const qualityScore = calculateQualityScore(metadata);

    if (qualityScore < minQualityScore) {
      // Delete low-quality image
      try {
        fs.unlinkSync(destPath);
      } catch { /* ignore */ }
      return { success: false, qualityScore, metadata };
    }

    return { success: true, qualityScore, metadata };
  } catch (e) {
    console.error(`[image-scraper] Failed to download ${url}:`, e instanceof Error ? e.message : e);
    return { success: false, qualityScore: 0, metadata: null };
  }
}

export interface ScrapeImagesResult {
  images: ImageSource[];
  stats: {
    total_requested: number;
    scraped_count: number;
    ai_generated_count: number;
    failed_urls: number;
    low_quality_rejected: number;
  };
}

/**
 * Smart image scraper: fetches from articles, validates, falls back to web search
 */
export async function scrapeAndValidateImages(
  articleUrls: string[],
  episodeId: string,
  requiredCount: number,
  minQualityScore = 40,
  script?: { title: string; segments: { text: string }[] } // Optional: script for intelligent web image fallback
): Promise<ScrapeImagesResult> {
  const framesDir = path.join(process.cwd(), "data", "frames");
  try {
    if (!fs.existsSync(framesDir)) fs.mkdirSync(framesDir, { recursive: true });
  } catch (e) {
    // Read-only filesystem - return empty
    return {
      images: [],
      stats: {
        total_requested: requiredCount,
        scraped_count: 0,
        ai_generated_count: 0,
        failed_urls: articleUrls.length,
        low_quality_rejected: 0,
      },
    };
  }

  const validImages: ImageSource[] = [];
  let failedUrls = 0;
  let lowQualityRejected = 0;

  // Download and validate images from articles
  console.log(`[image-scraper] Starting scrape: ${articleUrls.length} article URLs, need ${requiredCount} images`);
  const scrapeApiId = `scrape_${crypto.randomBytes(4).toString("hex")}`;
  const scrapeStartMs = Date.now();
  trackModelApi(scrapeApiId, "Article Scraper", "pending");
  
  for (let i = 0; i < articleUrls.length && validImages.length < requiredCount; i++) {
    const url = articleUrls[i];
    const destPath = path.join(framesDir, `${episodeId}_article_${i}.jpg`);

    const result = await downloadAndValidateImage(url, destPath, minQualityScore);

    if (result.success && result.metadata) {
      validImages.push({
        path: destPath,
        source: "article",
        article_url: url,
        width: result.metadata.width,
        height: result.metadata.height,
        quality_score: result.qualityScore,
      });
      console.log(`[image-scraper] ✓ Scraped image ${validImages.length}/${requiredCount}: ${url.slice(0, 60)}... (quality: ${result.qualityScore})`);
    } else {
      if (result.qualityScore > 0 && result.qualityScore < minQualityScore) {
        lowQualityRejected++;
        console.log(`[image-scraper] ✗ Rejected low quality (${result.qualityScore}): ${url.slice(0, 60)}...`);
      } else {
        failedUrls++;
        console.log(`[image-scraper] ✗ Failed to download: ${url.slice(0, 60)}...`);
      }
    }

    // Small delay to be respectful
    if (i < articleUrls.length - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  trackModelApi(scrapeApiId, "Article Scraper", "resolved", Date.now() - scrapeStartMs);

  // If we still need more images and have a script, use Groq Llama to generate smart Unsplash queries
  if (validImages.length < requiredCount && script) {
    const need = requiredCount - validImages.length;
    console.log(`[image-scraper] Need ${need} more images, asking Llama for specific queries`);
    
    let queries: string[] = [];
    try {
      const { data } = await chatJson<{ queries: string[] }>({
        model: LLM_MODELS.frontier,
        system: "You are a photo editor. Given a podcast script, generate exactly the requested number of short, highly specific Unsplash search queries (2-4 words each) that visually represent key moments in the story. Return JSON: { \"queries\": [\"query 1\", \"query 2\"] }",
        user: `Script title: ${script.title}\n\nSegments:\n${script.segments.map(s => s.text).join(" ")}\n\nGenerate exactly ${need} search queries.`,
        jsonObject: true
      });
      queries = data.queries || [];
    } catch (e) {
      console.error("[image-scraper] Failed to generate queries with Llama:", e);
    }
    
    // Fallback if LLM failed
    if (queries.length === 0) {
      queries = Array(need).fill(script.title);
    } else if (queries.length < need) {
      queries = [...queries, ...Array(need - queries.length).fill(queries[queries.length - 1] || script.title)];
    }

    const webImages: { url: string; path: string }[] = [];
    for (let i = 0; i < need; i++) {
      const queryImages = await searchWebImages(queries[i], 1, episodeId, validImages.length + i);
      if (queryImages.length > 0) webImages.push(queryImages[0]);
    }
    
    for (const webImg of webImages) {
      const result = await downloadAndValidateImage(webImg.url, webImg.path, minQualityScore);
      
      if (result.success && result.metadata) {
        validImages.push({
          path: webImg.path,
          source: "article", // Mark as article since it's from web search for the story
          article_url: webImg.url,
          width: result.metadata.width,
          height: result.metadata.height,
          quality_score: result.qualityScore,
        });
        console.log(`[image-scraper] ✓ Found via web search ${validImages.length}/${requiredCount} (quality: ${result.qualityScore})`);
      }
      
      if (validImages.length >= requiredCount) break;
      await new Promise(r => setTimeout(r, 800)); // Longer delay for web scraping
    }
  }

  return {
    images: validImages,
    stats: {
      total_requested: requiredCount,
      scraped_count: validImages.length,
      ai_generated_count: 0,
      failed_urls: failedUrls,
      low_quality_rejected: lowQualityRejected,
    },
  };
}

/**
 * Search for images on the web using DuckDuckGo image search
 * This is a fallback when article images are insufficient
 */
async function searchWebImages(
  query: string,
  count: number,
  episodeId: string,
  startIndex: number
): Promise<{ url: string; path: string }[]> {
  try {
    // Use DuckDuckGo image search (doesn't require API key)
    const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query + " news")}&t=h_&iax=images&ia=images`;
    
    console.log(`[image-scraper] Searching DuckDuckGo for: "${query}"`);
    
    // Simple approach: construct predictable news image URLs
    // In production, you'd want to use a proper image search API like:
    // - Bing Image Search API
    // - Google Custom Search API
    // - Unsplash API (for generic images)
    
    // For now, return Unsplash placeholder URLs based on the query
    // You should replace this with actual web scraping or API calls
    const images: { url: string; path: string }[] = [];
    
    const framesDir = path.join(process.cwd(), "data", "frames");
    const unsplashKey = process.env.UNSPLASH_ACCESS_KEY;
    if (unsplashKey) {
      console.log(`[image-scraper] Using Unsplash API for query: "${query}"`);
      const apiId = `unsplash_${crypto.randomBytes(4).toString("hex")}`;
      const startMs = Date.now();
      trackModelApi(apiId, "Unsplash API", "pending");
      try {
        const res = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${count}&orientation=landscape`, {
          headers: { "Authorization": `Client-ID ${unsplashKey}` },
          signal: AbortSignal.timeout(10000)
        });
        if (res.ok) {
          const data = await res.json() as { results?: { urls?: { raw: string } }[] };
          const results = data.results || [];
          for (let i = 0; i < Math.min(results.length, count); i++) {
            if (results[i]?.urls?.raw) {
              images.push({
                url: `${results[i].urls.raw}&w=1280&h=720&fit=crop`,
                path: path.join(framesDir, `${episodeId}_web_${startIndex + i}.jpg`)
              });
            }
          }
          trackModelApi(apiId, "Unsplash API", "resolved", Date.now() - startMs);
          if (images.length > 0) return images;
        } else {
          console.warn(`[image-scraper] Unsplash API returned ${res.status}`);
          trackModelApi(apiId, "Unsplash API", "error");
        }
      } catch (err) {
        console.error("[image-scraper] Unsplash API error:", err);
        trackModelApi(apiId, "Unsplash API", "error");
      }
    }

    // Try to get images from Unsplash (legacy fallback)
    const keywords = query.split(" ").slice(0, 3).join(",");
    for (let i = 0; i < Math.min(count, 5); i++) {
      images.push({
        url: `https://source.unsplash.com/1280x720/?${keywords},news,${i}`,
        path: path.join(framesDir, `${episodeId}_web_${startIndex + i}.jpg`)
      });
    }
    
    return images;
  } catch (e) {
    console.error("[image-scraper] Web search failed:", e);
    return [];
  }
}

