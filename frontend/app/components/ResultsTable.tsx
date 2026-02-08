"use client";

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ArrowDownLeft, ArrowUpRight, Calendar, Download, Loader2, RotateCcw } from "lucide-react";
import { ConvertResponse } from "@/app/types";
import { downloadCsv } from "@/app/lib/api";

const PREVIEW_ROW_COUNT = 10;

interface ResultsTableProps {
  result: ConvertResponse;
  onReset: () => void;
}

export default function ResultsTable({ result, onReset }: ResultsTableProps) {
  const [isDownloading, setIsDownloading] = useState(false);

  const { headers, rows, totalRows, processingTime, summary, fileName } = result.data;
  const previewRows = rows.slice(0, PREVIEW_ROW_COUNT);

  const formatCurrency = (value: number) =>
    value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const formatDate = (iso: string) => {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const hasSummary =
    summary &&
    (summary.startDate || summary.totalCredited !== null || summary.totalDebited !== null);

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const blob = await downloadCsv(headers, rows);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // download errors are non-critical, the user can retry
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-4">
      {/* Summary bar */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-600">
            Showing {Math.min(PREVIEW_ROW_COUNT, totalRows)} of {totalRows} transactions
            {" \u00b7 "}
            {headers.length} columns
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onReset}>
            <RotateCcw className="h-4 w-4 mr-1.5" />
            New file
          </Button>
          <Button size="sm" onClick={handleDownload} disabled={isDownloading}>
            {isDownloading ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-1.5" />
            )}
            Download CSV
          </Button>
        </div>
      </div>

      {/* Statement summary */}
      {hasSummary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {summary.startDate && (
            <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
              <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                <Calendar className="h-3.5 w-3.5" />
                Start date
              </div>
              <p className="text-sm font-semibold text-gray-900">{formatDate(summary.startDate)}</p>
            </div>
          )}
          {summary.endDate && (
            <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
              <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                <Calendar className="h-3.5 w-3.5" />
                End date
              </div>
              <p className="text-sm font-semibold text-gray-900">{formatDate(summary.endDate)}</p>
            </div>
          )}
          {summary.totalCredited !== null && (
            <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3">
              <div className="flex items-center gap-1.5 text-xs text-green-700 mb-1">
                <ArrowDownLeft className="h-3.5 w-3.5" />
                Total credited
              </div>
              <p className="text-sm font-semibold text-green-800">{formatCurrency(summary.totalCredited)}</p>
            </div>
          )}
          {summary.totalDebited !== null && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
              <div className="flex items-center gap-1.5 text-xs text-red-700 mb-1">
                <ArrowUpRight className="h-3.5 w-3.5" />
                Total debited
              </div>
              <p className="text-sm font-semibold text-red-800">{formatCurrency(summary.totalDebited)}</p>
            </div>
          )}
        </div>
      )}

      {/* Data table */}
      <div className="rounded-lg border border-gray-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50">
              {headers.map((header, i) => (
                <TableHead key={i} className="text-xs font-semibold text-gray-700">
                  {header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {previewRows.map((row, rowIndex) => (
              <TableRow key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <TableCell key={cellIndex} className="text-sm text-gray-800">
                    {cell}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Truncation notice */}
      {totalRows > PREVIEW_ROW_COUNT && (
        <p className="text-center text-xs text-gray-500">
          {totalRows - PREVIEW_ROW_COUNT} more rows in download
        </p>
      )}
    </div>
  );
}
