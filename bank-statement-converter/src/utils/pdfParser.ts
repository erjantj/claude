import * as pdfjsLib from 'pdfjs-dist';
import type { Transaction, ParsedStatement } from '../types/transaction';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

export async function parsePDF(file: File): Promise<ParsedStatement> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let fullText = '';

  // Extract text from all pages
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ');
    fullText += pageText + '\n';
  }

  const transactions = parseTransactions(fullText);

  return {
    transactions,
    accountInfo: extractAccountInfo(fullText),
  };
}

function parseTransactions(text: string): Transaction[] {
  const transactions: Transaction[] = [];

  // Split text into lines for processing
  const lines = text.split(/\n|\s{3,}/);

  for (const line of lines) {
    const transaction = parseTransactionLine(line);
    if (transaction) {
      transactions.push(transaction);
    }
  }

  // If no transactions found with line parsing, try pattern matching
  if (transactions.length === 0) {
    const patternTransactions = parseWithPatterns(text);
    transactions.push(...patternTransactions);
  }

  return transactions;
}

function parseTransactionLine(line: string): Transaction | null {
  // Skip empty lines or headers
  if (!line || line.length < 10) return null;

  // Common transaction line patterns
  // Pattern: Date Description Amount (with optional balance)
  const patterns = [
    // MM/DD/YYYY Description $1,234.56 or -$1,234.56
    /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s+(.+?)\s+(-?\$?[\d,]+\.?\d*)\s*(-?\$?[\d,]+\.?\d*)?$/,
    // DD Mon YYYY Description Amount
    /(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4})\s+(.+?)\s+(-?\$?[\d,]+\.?\d*)\s*(-?\$?[\d,]+\.?\d*)?$/i,
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match) {
      const [, date, description, amountStr, balanceStr] = match;
      const amount = parseAmount(amountStr);

      if (!isNaN(amount)) {
        return {
          date: date.trim(),
          description: description.trim(),
          amount: Math.abs(amount),
          type: amount < 0 || amountStr.includes('-') ? 'debit' : 'credit',
          balance: balanceStr ? parseAmount(balanceStr) : undefined,
        };
      }
    }
  }

  return null;
}

function parseWithPatterns(text: string): Transaction[] {
  const transactions: Transaction[] = [];

  // More aggressive pattern matching for various bank statement formats
  const combinedPattern = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s+([A-Za-z][^\d]*?)\s+(\-?\$?[\d,]+\.\d{2})/g;

  let match;
  while ((match = combinedPattern.exec(text)) !== null) {
    const [, date, description, amountStr] = match;
    const amount = parseAmount(amountStr);

    if (!isNaN(amount) && description.trim().length > 2) {
      transactions.push({
        date: date.trim(),
        description: description.trim().replace(/\s+/g, ' '),
        amount: Math.abs(amount),
        type: amountStr.includes('-') ? 'debit' : 'credit',
      });
    }
  }

  return transactions;
}

function parseAmount(amountStr: string): number {
  if (!amountStr) return NaN;
  // Remove currency symbols and commas, handle negative numbers
  const cleaned = amountStr.replace(/[$,\s]/g, '');
  return parseFloat(cleaned);
}

function extractAccountInfo(text: string): ParsedStatement['accountInfo'] {
  const info: ParsedStatement['accountInfo'] = {};

  // Try to extract account number
  const accountMatch = text.match(/(?:Account|Acct|A\/C)[\s#:]*(\d{4,}[\d\-\*]*\d{4})/i);
  if (accountMatch) {
    info.accountNumber = accountMatch[1];
  }

  // Try to extract statement period
  const periodMatch = text.match(/(?:Statement Period|Period|From)[\s:]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s*(?:to|through|-)\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
  if (periodMatch) {
    info.statementPeriod = `${periodMatch[1]} - ${periodMatch[2]}`;
  }

  return Object.keys(info).length > 0 ? info : undefined;
}
