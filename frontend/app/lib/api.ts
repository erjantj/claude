import { ConvertResponse, ApiError } from "@/app/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export class ApiRequestError extends Error {
  code: string;
  upgradeUrl?: string;

  constructor(error: ApiError) {
    super(error.message);
    this.code = error.error;
    this.upgradeUrl = error.upgrade_url;
    this.name = "ApiRequestError";
  }
}

export async function convertPdf(file: File): Promise<ConvertResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_URL}/api/convert`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    let errorData: ApiError;
    try {
      const body = await response.json();
      errorData = body.detail || body;
    } catch {
      errorData = {
        error: "PROCESSING_ERROR",
        message: "Something went wrong. Please try again",
      };
    }
    throw new ApiRequestError(errorData);
  }

  return response.json();
}

export async function downloadCsv(
  headers: string[],
  rows: string[][]
): Promise<Blob> {
  const response = await fetch(`${API_URL}/api/download`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ headers, rows }),
  });

  if (!response.ok) {
    throw new Error("Failed to download CSV");
  }

  return response.blob();
}
