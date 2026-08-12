import type Database from "better-sqlite3";

export interface ResumeRecord {
  filename: string;
  extractedText: string;
  uploadedAt: string;
  mimeType: string;
  fileBytes: Buffer;
}

export function saveResume(db: Database.Database, resume: ResumeRecord): void {
  db.prepare(
    `INSERT INTO resume (id, filename, extracted_text, uploaded_at, mime_type, file_bytes)
     VALUES (1, @filename, @extractedText, @uploadedAt, @mimeType, @fileBytes)
     ON CONFLICT(id) DO UPDATE SET
       filename = excluded.filename,
       extracted_text = excluded.extracted_text,
       uploaded_at = excluded.uploaded_at,
       mime_type = excluded.mime_type,
       file_bytes = excluded.file_bytes`
  ).run(resume);
}

export function getResume(db: Database.Database): ResumeRecord | null {
  const row = db
    .prepare(
      `SELECT filename, extracted_text, uploaded_at, mime_type, file_bytes FROM resume WHERE id = 1`
    )
    .get() as
    | {
        filename: string;
        extracted_text: string;
        uploaded_at: string;
        mime_type: string;
        file_bytes: Buffer;
      }
    | undefined;

  if (!row) return null;
  return {
    filename: row.filename,
    extractedText: row.extracted_text,
    uploadedAt: row.uploaded_at,
    mimeType: row.mime_type,
    fileBytes: row.file_bytes,
  };
}
