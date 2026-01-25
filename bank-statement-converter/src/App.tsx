import { useState } from 'react';
import { FileUpload } from './components/FileUpload';
import { TransactionTable } from './components/TransactionTable';
import { ExportButton } from './components/ExportButton';
import { StatsCard } from './components/StatsCard';
import { parsePDF } from './utils/pdfParser';
import type { ParsedStatement } from './types/transaction';
import './App.css';

function App() {
  const [isLoading, setIsLoading] = useState(false);
  const [parsedData, setParsedData] = useState<ParsedStatement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleFileSelect = async (file: File) => {
    setIsLoading(true);
    setError(null);
    setFileName(file.name);

    try {
      const data = await parsePDF(file);
      setParsedData(data);
    } catch (err) {
      console.error('Error parsing PDF:', err);
      setError('Failed to parse the PDF. Please ensure it is a valid bank statement.');
      setParsedData(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    setParsedData(null);
    setError(null);
    setFileName(null);
  };

  return (
    <div className="app">
      <header className="header">
        <h1>Bank Statement Converter</h1>
        <p className="subtitle">
          Upload your bank statement PDF and convert it to a spreadsheet
        </p>
      </header>

      <main className="main">
        {!parsedData && !error && (
          <section className="upload-section">
            <FileUpload onFileSelect={handleFileSelect} isLoading={isLoading} />
          </section>
        )}

        {error && (
          <section className="error-section">
            <div className="error-card">
              <svg
                className="error-icon"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <p>{error}</p>
              <button className="retry-button" onClick={handleReset}>
                Try Again
              </button>
            </div>
          </section>
        )}

        {parsedData && (
          <section className="results-section">
            <div className="results-header">
              <div className="file-info">
                <span className="file-name">{fileName}</span>
                <button className="reset-button" onClick={handleReset}>
                  Upload New File
                </button>
              </div>
              <ExportButton
                data={parsedData}
                disabled={parsedData.transactions.length === 0}
              />
            </div>

            <StatsCard transactions={parsedData.transactions} />

            <div className="table-section">
              <h2>Transactions</h2>
              <TransactionTable transactions={parsedData.transactions} sections={parsedData.sections} />
            </div>
          </section>
        )}
      </main>

      <footer className="footer">
        <p>Your data is processed locally and never leaves your browser.</p>
      </footer>
    </div>
  );
}

export default App;
