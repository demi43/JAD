import type { CompanySource, Posting } from "../types.js";

interface GreenhouseJob {
  id: number;
  title: string;
  location: { name: string } | null;
  absolute_url: string;
  content: string;
  updated_at: string | null;
}

interface GreenhouseResponse {
  jobs: GreenhouseJob[];
}

export async function fetchGreenhousePostings(
  source: CompanySource,
  now: () => string = () => new Date().toISOString()
): Promise<Posting[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${source.identifier}/jobs?content=true`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Greenhouse fetch failed for ${source.identifier}: ${res.status} ${res.statusText}`
    );
  }
  const data = (await res.json()) as GreenhouseResponse;
  const discoveredAt = now();

  return data.jobs.map((job) => ({
    id: `greenhouse:${job.id}`,
    company: source.name,
    ats: "greenhouse" as const,
    title: job.title,
    location: job.location?.name ?? "Unknown",
    url: job.absolute_url,
    descriptionHtml: job.content,
    postedAt: job.updated_at ?? null,
    discoveredAt,
  }));
}
