"use client";

import { useCallback, useState, useEffect } from "react";
import { useDropzone, FileRejection } from "react-dropzone";
import { Upload, FileText, AlertCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { convertPdf, ApiRequestError } from "@/app/lib/api";
import { ConvertResponse } from "@/app/types";

const LOADING_MESSAGES = [
  "Waking up the PDF elves...",
  "Teaching your numbers to line up...",
  "Convincing columns to behave...",
  "Translating banker-speak to CSV...",
  "Almost there, pinky promise...",
];

const MIN_LOADING_MS = 3000;
const MESSAGE_INTERVAL_MS = 1800;

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_FILE_TYPE: "Please upload a PDF file.",
  FILE_TOO_LARGE: "File too large. Maximum size is 10MB.",
  NO_TABLES_FOUND:
    "No tables detected in this PDF. Try a different file or check that it contains tabular data.",
  PROCESSING_ERROR: "Something went wrong. Please try again.",
  FREE_TIER_LIMIT:
    "You've reached your free tier limit (5 conversions/day). Please try again tomorrow.",
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface FileUploadProps {
  onConvertSuccess: (data: ConvertResponse) => void;
}

export default function FileUpload({ onConvertSuccess }: FileUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messageIndex, setMessageIndex] = useState(0);

  // Cycle through funny loading messages
  useEffect(() => {
    if (!isUploading) {
      setMessageIndex(0);
      return;
    }
    const timer = setInterval(() => {
      setMessageIndex((i) => (i + 1) % LOADING_MESSAGES.length);
    }, MESSAGE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isUploading]);

  const onDrop = useCallback(
    (acceptedFiles: File[], fileRejections: FileRejection[]) => {
      setError(null);

      if (fileRejections.length > 0) {
        const rejection = fileRejections[0];
        const errorCode = rejection.errors[0]?.code;

        if (errorCode === "file-too-large") {
          setError(ERROR_MESSAGES.FILE_TOO_LARGE);
        } else if (
          errorCode === "file-invalid-type" ||
          errorCode === "too-many-files"
        ) {
          setError(ERROR_MESSAGES.INVALID_FILE_TYPE);
        } else {
          setError(rejection.errors[0]?.message || "Invalid file.");
        }
        return;
      }

      if (acceptedFiles.length > 0) {
        setFile(acceptedFiles[0]);
      }
    },
    []
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/pdf": [".pdf"] },
    maxSize: MAX_FILE_SIZE,
    multiple: false,
  });

  const handleConvert = async () => {
    if (!file) return;

    setIsUploading(true);
    setError(null);

    const startedAt = Date.now();

    try {
      const result = await convertPdf(file);

      // Ensure the loading animation plays for at least MIN_LOADING_MS
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_LOADING_MS) {
        await new Promise((r) => setTimeout(r, MIN_LOADING_MS - elapsed));
      }

      onConvertSuccess(result);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(ERROR_MESSAGES[err.code] || err.message);
      } else {
        setError(ERROR_MESSAGES.PROCESSING_ERROR);
      }
    } finally {
      setIsUploading(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setError(null);
    setIsUploading(false);
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-4">
      {/* Loading state — replaces dropzone + file info */}
      {isUploading ? (
        <div className="rounded-lg border border-blue-200 bg-gradient-to-b from-blue-50 to-white p-12 flex flex-col items-center gap-5">
          {/* Pulsing icon */}
          <div className="h-14 w-14 rounded-full bg-blue-100 flex items-center justify-center animate-pulse">
            <FileText className="h-7 w-7 text-blue-600" />
          </div>

          {/* File name */}
          {file && (
            <p className="text-xs font-medium text-blue-600/70 tracking-wide uppercase">
              {file.name}
            </p>
          )}

          {/* Cycling message */}
          <p
            key={messageIndex}
            className="text-lg font-medium text-gray-800 animate-fade-in"
          >
            {LOADING_MESSAGES[messageIndex]}
          </p>

          {/* Progress bar */}
          <div className="w-64 h-1.5 bg-blue-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full animate-progress" />
          </div>
        </div>
      ) : (
        <>
          {/* Dropzone */}
          <div
            {...getRootProps()}
            className={`
              relative border-2 border-dashed rounded-lg p-12
              flex flex-col items-center justify-center gap-4
              cursor-pointer transition-colors duration-200
              ${
                isDragActive
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-300 hover:border-gray-400 bg-white"
              }
            `}
          >
            <input {...getInputProps()} />

            {isDragActive ? (
              <>
                <Upload className="h-12 w-12 text-blue-500" />
                <p className="text-lg font-medium text-blue-600">
                  Drop your PDF here
                </p>
              </>
            ) : (
              <>
                <Upload className="h-12 w-12 text-gray-400" />
                <div className="text-center">
                  <p className="text-lg font-medium text-gray-700">
                    Drag & drop your PDF here or click to browse
                  </p>
                  <p className="text-sm text-gray-500 mt-1">
                    PDF files only, up to 10MB
                  </p>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* Selected file info */}
      {file && !isUploading && (
        <div className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3 border border-gray-200">
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-blue-500 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-gray-800 truncate max-w-xs">
                {file.name}
              </p>
              <p className="text-xs text-gray-500">
                {formatFileSize(file.size)}
              </p>
            </div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleReset();
            }}
            className="text-gray-400 hover:text-gray-600 p-1"
            aria-label="Remove file"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Error message */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Convert button */}
      {file && !isUploading && (
        <Button onClick={handleConvert} className="w-full" size="lg">
          Convert to CSV
        </Button>
      )}
    </div>
  );
}
