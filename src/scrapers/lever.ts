import type { CompanySource, Posting } from "../types.js";

interface LeverPosting {
  id: string;
  text: string;
  categories: { location?: string } | null;
  description: string;
  hostedUrl: string;
  createdAt: number | null;
}

export async function fetchLeverPostings(
  source: CompanySource,
  now: () => string = () => new Date().toISOString()
): Promise<Posting[]> {
  const url = `https://api.lever.co/v0/postings/${source.identifier}?mode=json`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Lever fetch failed for ${source.identifier}: ${res.status} ${res.statusText}`
    );
  }
  const jobs = (await res.json()) as LeverPosting[];
  const discoveredAt = now();

  return jobs.map((job) => ({
    id: `lever:${job.id}`,
    company: source.name,
    ats: "lever" as const,
    title: job.text,
    location: job.categories?.location ?? "Unknown",
    url: job.hostedUrl,
    descriptionHtml: job.description,
    postedAt: job.createdAt ? new Date(job.createdAt).toISOString() : null,
    discoveredAt,
  }));
}
