export type AtsPlatform = "greenhouse" | "lever";

export interface CompanySource {
  name: string;
  ats: AtsPlatform;
  /** Greenhouse board token or Lever company slug, depending on `ats`. */
  identifier: string;
}

export interface Posting {
  /** Stable id, e.g. `greenhouse:123456` or `lever:abcd-1234`. */
  id: string;
  company: string;
  ats: AtsPlatform;
  title: string;
  location: string;
  url: string;
  descriptionHtml: string;
  /** ISO date string, or null if the source didn't provide one. */
  postedAt: string | null;
  /** ISO date string of when we scraped it. */
  discoveredAt: string;
}
