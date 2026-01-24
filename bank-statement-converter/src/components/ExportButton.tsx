import { useState } from 'react';
import type { ParsedStatement } from '../types/transaction';
import { generateSpreadsheet, type ExportFormat } from '../utils/spreadsheetGenerator';
import './ExportButton.css';

interface ExportButtonProps {
  data: ParsedStatement;
  disabled?: boolean;
}

export function ExportButton({ data, disabled }: ExportButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handleExport = (format: ExportFormat) => {
    generateSpreadsheet(data, format);
    setIsOpen(false);
  };

  return (
    <div className="export-container">
      <button
        className="export-button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
      >
        <svg
          className="export-icon"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        Export Spreadsheet
        <svg
          className={`chevron ${isOpen ? 'open' : ''}`}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {isOpen && (
        <div className="export-dropdown">
          <button className="dropdown-item" onClick={() => handleExport('xlsx')}>
            <span className="format-icon xlsx">XLS</span>
            Excel (.xlsx)
          </button>
          <button className="dropdown-item" onClick={() => handleExport('csv')}>
            <span className="format-icon csv">CSV</span>
            CSV (.csv)
          </button>
        </div>
      )}
    </div>
  );
}
