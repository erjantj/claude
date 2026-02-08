export interface Summary {
  startDate: string | null;
  endDate: string | null;
  totalCredited: number | null;
  totalDebited: number | null;
}

export interface ExtractedData {
  headers: string[];
  rows: string[][];
  totalRows: number;
  processingTime: number;
  summary: Summary;
  fileName: string;
}

export interface ConvertResponse {
  success: boolean;
  data: ExtractedData;
  preview: Record<string, string>[];
}

export interface ApiError {
  error: string;
  message: string;
  upgrade_url?: string;
}
