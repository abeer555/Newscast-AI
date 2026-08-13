export interface NewsSource {
  id: string;
  name: string;
  url: string;
  language: "en" | "ar";
  lean: "left" | "center-left" | "center" | "center-right" | "right" | "state" | "wire";
  country: string;
}

export const NEWS_SOURCES: NewsSource[] = [
  { id: "dw", name: "Deutsche Welle", url: "https://rss.dw.com/xml/rss-en-all", language: "en", lean: "center", country: "de" },
  { id: "ap", name: "Associated Press", url: "https://feedx.net/rss/ap.xml", language: "en", lean: "wire", country: "us" },
  { id: "bbc", name: "BBC News", url: "https://feeds.bbci.co.uk/news/world/rss.xml", language: "en", lean: "center", country: "uk" },
  { id: "guardian", name: "The Guardian", url: "https://www.theguardian.com/world/rss", language: "en", lean: "center-left", country: "uk" },
  { id: "aljazeera", name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml", language: "en", lean: "center-left", country: "qa" },
  { id: "cnn", name: "CNN", url: "http://rss.cnn.com/rss/edition_world.rss", language: "en", lean: "center-left", country: "us" },
  { id: "fox", name: "Fox News", url: "https://moxie.foxnews.com/google-publisher/world.xml", language: "en", lean: "right", country: "us" },
  { id: "nyt", name: "New York Times", url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml", language: "en", lean: "center-left", country: "us" },
  { id: "verge", name: "The Verge", url: "https://www.theverge.com/rss/index.xml", language: "en", lean: "center", country: "us" },
  { id: "techcrunch", name: "TechCrunch", url: "https://techcrunch.com/feed/", language: "en", lean: "center", country: "us" },
  { id: "ars", name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", language: "en", lean: "center", country: "us" },
  { id: "hn", name: "Hacker News", url: "https://hnrss.org/frontpage", language: "en", lean: "center", country: "us" },
  { id: "npr", name: "NPR", url: "https://feeds.npr.org/1001/rss.xml", language: "en", lean: "center-left", country: "us" },
  { id: "sky", name: "Sky News", url: "https://feeds.skynews.com/feeds/rss/world.xml", language: "en", lean: "center", country: "uk" },
  { id: "cnbc", name: "CNBC", url: "https://www.cnbc.com/id/100003114/device/rss/rss.html", language: "en", lean: "center-right", country: "us" },
  // India — independent desks across print, TV, wire
  { id: "hindu", name: "The Hindu", url: "https://www.thehindu.com/news/national/feeder/default.rss", language: "en", lean: "center-left", country: "in" },
  { id: "toi", name: "Times of India", url: "https://timesofindia.indiatimes.com/rssfeeds/1898055.cms", language: "en", lean: "center-right", country: "in" },
  { id: "ndtv", name: "NDTV", url: "https://feeds.feedburner.com/NDTV-LatestNews", language: "en", lean: "center", country: "in" },
  { id: "hindustan", name: "Hindustan Times", url: "https://www.hindustantimes.com/feeds/rss/india-news/rssfeed.xml", language: "en", lean: "center", country: "in" },
  { id: "news18", name: "News18", url: "https://www.news18.com/rss/india.xml", language: "en", lean: "center-right", country: "in" },
  { id: "theprint", name: "ThePrint", url: "https://theprint.in/feed/", language: "en", lean: "center-left", country: "in" },
  { id: "scroll", name: "Scroll.in", url: "https://feeds.feedburner.com/scrollin", language: "en", lean: "center-left", country: "in" },
  { id: "indiatoday", name: "India Today", url: "https://www.indiatoday.in/rss/1206514", language: "en", lean: "center", country: "in" },
  { id: "firstpost", name: "Firstpost", url: "https://www.firstpost.com/rss/india.xml", language: "en", lean: "center-right", country: "in" },
  { id: "thewire", name: "The Wire", url: "https://thewire.in/feed", language: "en", lean: "center-left", country: "in" },
];

export const INDIA_SOURCE_IDS = new Set(["hindu", "toi", "ndtv", "hindustan", "news18", "theprint", "scroll", "indiatoday", "firstpost", "thewire"]);

// Kokoro voice IDs — American English (af_ = American Female, am_ = American Male)
// Full list: hexgrad/Kokoro-82M on Hugging Face under voices/
export const VOICES = {
  en: [
    { id: "af_heart",   name: "Heart",   gender: "female" },
    { id: "af_bella",   name: "Bella",   gender: "female" },
    { id: "af_nicole",  name: "Nicole",  gender: "female" },
    { id: "af_sarah",   name: "Sarah",   gender: "female" },
    { id: "am_adam",    name: "Adam",    gender: "male"   },
    { id: "am_michael", name: "Michael", gender: "male"   },
  ],
  // Arabic not supported by Kokoro — audio generation is skipped for Arabic episodes
  ar: [] as { id: string; name: string; gender: string }[],
} as const;

// "kokoro" is a local-only sentinel — the actual model is the kokoro_server.py process.
// The value is used for analytics logging only; no cloud API is called.
export const TTS_MODELS = {
  en: "kokoro/af_heart",
  ar: null,   // no TTS for Arabic
} as const;

export const LLM = {
  structured: "openai/gpt-oss-120b", // strict json_schema supported
  general: "llama-3.3-70b-versatile", // fallback, json_object mode
  fast: "llama-3.1-8b-instant",
} as const;
