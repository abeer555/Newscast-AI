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

export const VOICES = {
  en: [
    { id: "autumn", name: "Autumn", gender: "female" },
    { id: "diana", name: "Diana", gender: "female" },
    { id: "hannah", name: "Hannah", gender: "female" },
    { id: "austin", name: "Austin", gender: "male" },
    { id: "daniel", name: "Daniel", gender: "male" },
    { id: "troy", name: "Troy", gender: "male" },
  ],
  ar: [
    { id: "abdullah", name: "Abdullah", gender: "male" },
    { id: "fahad", name: "Fahad", gender: "male" },
    { id: "sultan", name: "Sultan", gender: "male" },
    { id: "lulwa", name: "Lulwa", gender: "female" },
    { id: "noura", name: "Noura", gender: "female" },
    { id: "aisha", name: "Aisha", gender: "female" },
  ],
} as const;

export const TTS_MODELS = {
  en: "canopylabs/orpheus-v1-english",
  ar: "canopylabs/orpheus-arabic-saudi",
} as const;

export const LLM = {
  structured: "openai/gpt-oss-120b", // strict json_schema supported
  general: "llama-3.3-70b-versatile", // fallback, json_object mode
  fast: "llama-3.1-8b-instant",
} as const;
