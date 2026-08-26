import Link from "next/link";
import {
  HEAT_RECENCY_FLOOR,
  HEAT_WEIGHT_PER_ARTICLE,
  HEAT_WEIGHT_PER_SOURCE,
  HEAT_WINDOW_HOURS,
  IMPORTANCE_METHOD,
  MIN_AGE_HOURS,
  SENTIMENT_METHOD,
} from "@/lib/scoring";
import { CONFIDENCE_METHOD, TIER_METHOD } from "@/lib/verification";
import { INDEPENDENCE_METHOD } from "@/lib/independence";
import { LEAN_LABEL, NEWS_SOURCES } from "@/lib/sources";

export const metadata = {
  title: "Methodology — Newscast AI",
  description: "How every score, tier and label in Newscast AI is calculated.",
};

/**
 * The page every number links back to.
 *
 * Constants are imported from the scoring engine rather than typed out, so this
 * page cannot describe a formula the code no longer uses.
 */
export default function MethodologyPage() {
  const leans = Object.entries(LEAN_LABEL).map(([key, label]) => ({
    key,
    label,
    outlets: NEWS_SOURCES.filter((s) => s.lean === key).map((s) => s.name),
  }));

  return (
    <div style={{ maxWidth: 780 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">Methodology</h1>
          <p className="page-sub">
            Every figure in this product is derived from data you can inspect. This page is the
            reference for all of them.
          </p>
        </div>
        <Link className="btn ghost" href="/">
          Back to dashboard
        </Link>
      </div>

      <div className="prose">
        <p>
          Newscast AI reads public news feeds, groups articles that describe the same event, and
          compares how each outlet covered it. Three kinds of number appear in the interface:
          measurements taken from the article set, judgements made by a language model, and
          classifications maintained by hand. They are not equally reliable, and the interface says
          which is which.
        </p>

        <h2 id="tiers">Claim confidence tiers</h2>
        <p>
          A claim is a single checkable assertion extracted from an article — &ldquo;the strike killed
          at least thirteen people&rdquo;, not &ldquo;the situation is deteriorating&rdquo;. The same
          claim usually appears in several articles with different wording; those phrasings are
          grouped, and the group is graded by how many <em>independent reporting chains</em> carried
          it.
        </p>
        <h3>Confirmed</h3>
        <p>{TIER_METHOD.confirmed}</p>
        <h3>Corroborated</h3>
        <p>{TIER_METHOD.corroborated}</p>
        <h3>Reported</h3>
        <p>{TIER_METHOD.reported}</p>
        <h3>Disputed</h3>
        <p>{TIER_METHOD.disputed}</p>
        <h3>Unverified</h3>
        <p>{TIER_METHOD.unverified}</p>
        <p>
          The numeric confidence beside a tier is a smoothing function, not a probability:{" "}
          {CONFIDENCE_METHOD}
        </p>
        <p>
          Two limits worth knowing. Claim grouping is lexical — it matches content words, entities and
          numbers, and it will occasionally split two phrasings of the same fact, which understates
          support. And a claim can be carried by three independent newsrooms and still be wrong if all
          three trusted the same briefing; independence is a check on syndication, not on truth.
        </p>

        <h2 id="independence">Source independence</h2>
        <p>{INDEPENDENCE_METHOD}</p>
        <p>
          Ten outlets running one agency dispatch is one piece of evidence, not ten. So every trust
          signal counts reporting chains rather than logos. A chain is identified three ways, in
          descending order of reliability: an explicit agency credit in the byline; the outlet being a
          wire service itself; and near-duplicate body text across outlets, which catches syndication
          where the feed has stripped the byline.
        </p>
        <p>
          The honest caveat: many feeds publish no author field at all. Where provenance is unstated
          we label the article <code>Byline not stated</code> and treat it as its own chain, which can
          overstate independence. Wherever that happens, the evidence badge says so rather than
          quietly rounding up.
        </p>

        <h2 id="heat">Heat</h2>
        <p>
          Heat measures how hard a story is being covered right now. It is a measurement, not an
          opinion — breadth of coverage and volume of articles, decayed by age:
        </p>
        <p>
          <code>
            ({HEAT_WEIGHT_PER_SOURCE} × outlets + {HEAT_WEIGHT_PER_ARTICLE} × articles) × recency
          </code>
        </p>
        <p>
          Recency falls linearly from 1 to {HEAT_RECENCY_FLOOR} across a {HEAT_WINDOW_HOURS}-hour
          window, then holds at the floor so an older story with heavy coverage never scores zero.
          Story age is clamped to a minimum of {MIN_AGE_HOURS * 60} minutes, because a cluster minutes
          old would otherwise produce an implausible rate. Clicking any heat figure shows the itemised
          arithmetic for that story, including what the score was when it was last computed and what it
          has decayed to since.
        </p>

        <h2 id="velocity">Velocity</h2>
        <p>
          Velocity is <b>articles per hour</b> — how fast outlets are filing on this story. Two figures
          are shown where both are available: the lifetime average since the first article, and the
          trailing 24-hour rate, which is the one that tells you whether the story is still moving.
          Velocity says nothing about importance; a celebrity arrest can out-file a famine.
        </p>

        <h2 id="importance">Importance and sentiment</h2>
        <p>{IMPORTANCE_METHOD}</p>
        <p>{SENTIMENT_METHOD}</p>
        <p>
          These two are model judgements, and the interface marks them as such. They are useful for
          sorting and comparison and should not be read as measurements. Two runs on the same articles
          can differ by a few points.
        </p>

        <h2 id="lean">Editorial lean</h2>
        <p>
          The lean chip on a source card is a <b>fixed, editor-maintained classification of the
          outlet</b>, stored next to its feed URL in this repository. It is not inferred by a model, it
          is not computed from the article, and it is not a quality score. Its only purpose is to give
          you context when comparing emphasis and word choice across outlets. For accuracy, read the
          claim tiers.
        </p>
        <p>
          Labels are coarse by design and reasonable people dispute them. The current assignments:
        </p>
        <div className="stack" style={{ marginBottom: 18 }}>
          {leans
            .filter((l) => l.outlets.length)
            .map((l) => (
              <div key={l.key} style={{ fontSize: 13.5 }}>
                <b style={{ color: "var(--text)" }}>{l.label}</b>
                <span className="dim"> — {l.outlets.join(", ")}</span>
              </div>
            ))}
        </div>

        <h2 id="coverage">Coverage comparison</h2>
        <p>
          Publication order comes from each article&apos;s feed timestamp, so &ldquo;first to
          report&rdquo; means first to appear in the feed, which can lag a website by a few minutes.
          Unique-claim counts compare the claims extracted from one article against every other article
          in the same story: an outlet credited with adding three claims published three checkable
          assertions nobody else in the set had. Coverage gaps are drawn from the same comparison plus
          the model&apos;s outlet-by-outlet reading, and are phrased as gaps rather than accusations —
          a gap is often just a house style or a wire-length constraint.
        </p>

        <h2 id="publish">Publish gate</h2>
        <p>
          An episode is only marked ready when its script passes every gate: no claim in the script
          contradicted by the evidence layer, no unsupported figure, an accuracy score above the
          threshold, and audio that matches the script. Failures are listed individually with the
          specific fix, because &ldquo;61%&rdquo; on its own tells an editor nothing. A blocked episode
          can still be played and inspected — it simply is not marked publishable.
        </p>

        <h2 id="audio">Audio and visuals</h2>
        <p>
          Speech is synthesised locally with Kokoro-82M. Per-line timings shown in the transcript are{" "}
          <b>measured</b> from the generated audio files, not estimated from word counts, which is what
          makes the highlight during playback line up with what you hear. Illustrations are generated
          by an image model unless a card explicitly credits a source photograph; every visual carries
          its own provenance label, and nothing generated is presented as documentary evidence.
        </p>
      </div>
    </div>
  );
}
