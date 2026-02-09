"use client";

import { useState } from "react";
import FileUpload from "@/app/components/FileUpload";
import ResultsTable from "@/app/components/ResultsTable";
import { ConvertResponse } from "@/app/types";
import { FileSpreadsheet } from "lucide-react";

export default function Home() {
  const [convertResult, setConvertResult] = useState<ConvertResponse | null>(
    null
  );

  const handleConvertSuccess = (data: ConvertResponse) => {
    setConvertResult(data);
  };

  const handleReset = () => {
    setConvertResult(null);
  };

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-2">
          <FileSpreadsheet className="h-7 w-7 text-blue-600" />
          <h1 className="text-xl font-bold text-gray-900">StatementCSV</h1>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-16">
        {convertResult ? (
          <ResultsTable result={convertResult} onReset={handleReset} />
        ) : (
          <>
            <div className="text-center mb-10">
              <h2 className="text-3xl font-bold text-gray-900 mb-3">
                Convert PDF Statements to CSV in Seconds
              </h2>
              <p className="text-lg text-gray-600 max-w-xl mx-auto">
                Upload your bank statement, credit card statement, or any PDF
                with tables — get a clean CSV file instantly.
              </p>
            </div>

            <FileUpload onConvertSuccess={handleConvertSuccess} />
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-4 text-center text-sm text-gray-500">
          Your files are processed securely and never stored on our servers.
        </div>
      </footer>
    </div>
  );
}
