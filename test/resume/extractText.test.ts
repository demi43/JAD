import { describe, it, expect, vi } from "vitest";

vi.mock("pdf-parse", () => ({
  default: vi.fn().mockResolvedValue({ text: "  Extracted PDF text.  " }),
}));
vi.mock("mammoth", () => ({
  default: { extractRawText: vi.fn().mockResolvedValue({ value: "  Extracted DOCX text.  " }) },
}));

const { extractResumeText } = await import("../../src/resume/extractText.js");
const pdfParse = (await import("pdf-parse")).default;
const mammoth = (await import("mammoth")).default;

describe("extractResumeText", () => {
  it("extracts text from a PDF buffer", async () => {
    const text = await extractResumeText(Buffer.from("fake pdf bytes"), "application/pdf");
    expect(text).toBe("Extracted PDF text.");
    expect(pdfParse).toHaveBeenCalledWith(expect.any(Buffer));
  });

  it("extracts text from a DOCX buffer", async () => {
    const text = await extractResumeText(
      Buffer.from("fake docx bytes"),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    expect(text).toBe("Extracted DOCX text.");
    expect(mammoth.extractRawText).toHaveBeenCalledWith({ buffer: expect.any(Buffer) });
  });

  it("throws for unsupported mime types", async () => {
    await expect(extractResumeText(Buffer.from("x"), "text/plain")).rejects.toThrow(
      /Unsupported resume file type/
    );
  });
});
