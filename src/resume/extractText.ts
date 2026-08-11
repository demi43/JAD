import pdfParse from "pdf-parse";
import mammoth from "mammoth";

export async function extractResumeText(buffer: Buffer, mimeType: string): Promise<string> {
  switch (mimeType) {
    case "application/pdf": {
      const data = await pdfParse(buffer);
      return data.text.trim();
    }
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
      const result = await mammoth.extractRawText({ buffer });
      return result.value.trim();
    }
    default:
      throw new Error(`Unsupported resume file type "${mimeType}". Upload a PDF or DOCX file.`);
  }
}
