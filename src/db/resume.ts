import type Database from "better-sqlite3";

export interface ResumeRecord {
  filename: string;
  extractedText: string;
  uploadedAt: string;
}

export function saveResume(db: Database.Database, resume: ResumeRecord): void {
  db.prepare(
    `INSERT INTO resume (id, filename, extracted_text, uploaded_at)
     VALUES (1, @filename, @extractedText, @uploadedAt)
     ON CONFLICT(id) DO UPDATE SET
       filename = excluded.filename,
       extracted_text = excluded.extracted_text,
       uploaded_at = excluded.uploaded_at`
  ).run(resume);
}

export function getResume(db: Database.Database): ResumeRecord | null {
  const row = db
    .prepare(`SELECT filename, extracted_text, uploaded_at FROM resume WHERE id = 1`)
    .get() as { filename: string; extracted_text: string; uploaded_at: string } | undefined;

  if (!row) return null;
  return {
    filename: row.filename,
    extractedText: row.extracted_text,
    uploadedAt: row.uploaded_at,
  };
}
