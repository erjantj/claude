import * as pdfjsLib from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import type { Transaction, ParsedStatement } from '../types/transaction';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

export async function parsePDF(file: File): Promise<ParsedStatement> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const lines: string[] = [];

  // Extract text from all pages, preserving line structure
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageLines = extractLinesFromPage(textContent.items as TextItem[]);
    lines.push(...pageLines);
  }

  const fullText = lines.join('\n');
  const transactions = parseTransactions(lines, fullText);

  return {
    transactions,
    accountInfo: extractAccountInfo(fullText),
  };
}

function extractLinesFromPage(items: TextItem[]): string[] {
  if (items.length === 0) return [];

  // Group text items by their Y position (line)
  const lineMap = new Map<number, { x: number; text: string }[]>();
  const tolerance = 3; // Y position tolerance for same line

  for (const item of items) {
    if (!item.str || item.str.trim() === '') continue;

    const y = Math.round(item.transform[5] / tolerance) * tolerance;
    const x = item.transform[4];

    if (!lineMap.has(y)) {
      lineMap.set(y, []);
    }
    lineMap.get(y)!.push({ x, text: item.str });
  }

  // Sort lines by Y position (descending, since PDF Y goes bottom-up)
  const sortedYPositions = Array.from(lineMap.keys()).sort((a, b) => b - a);

  const lines: string[] = [];
  for (const y of sortedYPositions) {
    const lineItems = lineMap.get(y)!;
    // Sort items in line by X position
    lineItems.sort((a, b) => a.x - b.x);

    // Join with appropriate spacing
    let lineText = '';
    let lastX = 0;
    for (const item of lineItems) {
      if (lineText && item.x - lastX > 20) {
        lineText += '  '; // Add extra space for column separation
      } else if (lineText) {
        lineText += ' ';
      }
      lineText += item.text;
      lastX = item.x + (item.text.length * 5); // Approximate end position
    }
    lines.push(lineText.trim());
  }

  return lines;
}

function parseTransactions(lines: string[], fullText: string): Transaction[] {
  let transactions: Transaction[] = [];

  // Strategy 1: Parse line by line
  for (const line of lines) {
    const transaction = parseTransactionLine(line);
    if (transaction) {
      transactions.push(transaction);
    }
  }

  // Strategy 2: If few transactions found, try pattern matching on full text
  if (transactions.length < 3) {
    const patternTransactions = parseWithPatterns(fullText);
    if (patternTransactions.length > transactions.length) {
      transactions = patternTransactions;
    }
  }

  // Strategy 3: Try to find transactions in a more relaxed way
  if (transactions.length < 3) {
    const relaxedTransactions = parseRelaxed(lines);
    if (relaxedTransactions.length > transactions.length) {
      transactions = relaxedTransactions;
    }
  }

  return transactions;
}

function parseTransactionLine(line: string): Transaction | null {
  if (!line || line.length < 10) return null;

  // Skip common header/footer lines
  const skipPatterns = [
    /^(date|description|amount|balance|transaction|posting|credit|debit)s?\s*$/i,
    /^page\s+\d+/i,
    /^(total|subtotal|balance forward|opening balance|closing balance)/i,
    /statement|account summary|account activity/i,
  ];

  for (const pattern of skipPatterns) {
    if (pattern.test(line)) return null;
  }

  // Find all amounts in the line (pattern: optional minus, optional $, digits with commas, decimal)
  const amountRegex = /-?\$?[\d,]+\.\d{2}/g;
  const amounts = line.match(amountRegex);

  // Need at least one amount
  if (!amounts || amounts.length === 0) return null;

  // Find date at the start of the line
  const datePatterns = [
    /^(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/,  // MM/DD/YYYY or DD-MM-YYYY
    /^(\d{1,2}[\/\-]\d{1,2})/,  // MM/DD or DD/MM (no year)
    /^((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{2,4})?)/i,  // Mon DD, YYYY
    /^(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{2,4})/i,  // DD Mon YYYY
    /^(\d{4}-\d{2}-\d{2})/,  // YYYY-MM-DD
  ];

  let date = '';
  for (const pattern of datePatterns) {
    const match = line.match(pattern);
    if (match) {
      date = match[1];
      break;
    }
  }

  if (!date) return null;

  // For 4-column format (Date, Description, Amount, Balance):
  // - If 2 amounts: first = transaction amount, second = balance
  // - If 1 amount: it's the transaction amount (no balance shown)
  let transactionAmountStr: string;
  let balanceStr: string | undefined;

  if (amounts.length >= 2) {
    // First amount is transaction, last amount is balance
    transactionAmountStr = amounts[0];
    balanceStr = amounts[amounts.length - 1];
  } else {
    transactionAmountStr = amounts[0];
  }

  const transactionAmount = parseAmount(transactionAmountStr);
  if (isNaN(transactionAmount) || transactionAmount === 0) return null;

  // Extract description: everything between date and first amount
  const dateEndIndex = line.indexOf(date) + date.length;
  const amountStartIndex = line.indexOf(transactionAmountStr);

  let description = '';
  if (amountStartIndex > dateEndIndex) {
    description = line.slice(dateEndIndex, amountStartIndex).trim();
  }

  description = description.replace(/\s+/g, ' ').trim();
  if (description.length < 2) return null;

  // Determine if debit or credit based on:
  // 1. Negative sign in amount
  // 2. Keywords in description
  const isDebit = transactionAmountStr.includes('-') ||
                  /withdrawal|debit|payment|purchase|fee|charge|sent|paid/i.test(description);

  return {
    date: date.trim(),
    description,
    amount: Math.abs(transactionAmount),
    type: isDebit ? 'debit' : 'credit',
    balance: balanceStr ? Math.abs(parseAmount(balanceStr)) : undefined,
  };
}

function parseWithPatterns(text: string): Transaction[] {
  const transactions: Transaction[] = [];
  const seen = new Set<string>();

  // Pattern to match: Date, Description, Amount, optional Balance
  // Captures date, description, transaction amount, and optional balance
  const patterns = [
    // Standard date format with two amounts (transaction + balance)
    /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s+([A-Za-z][^$\d]*?)\s+(-?\$?[\d,]+\.\d{2})\s+(-?\$?[\d,]+\.\d{2})/g,
    // Standard date format with one amount
    /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s+([A-Za-z][^$\d]*?)\s+(-?\$?[\d,]+\.\d{2})/g,
    // Mon DD format with two amounts
    /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{2,4})?)\s+([A-Za-z][^$\d]*?)\s+(-?\$?[\d,]+\.\d{2})\s+(-?\$?[\d,]+\.\d{2})/gi,
    // Mon DD format with one amount
    /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{2,4})?)\s+([A-Za-z][^$\d]*?)\s+(-?\$?[\d,]+\.\d{2})/gi,
  ];

  for (const pattern of patterns) {
    let match;
    // Reset regex
    pattern.lastIndex = 0;

    while ((match = pattern.exec(text)) !== null) {
      const [, date, description, amountStr, balanceStr] = match;
      const amount = parseAmount(amountStr);
      const descClean = description.trim().replace(/\s+/g, ' ');

      // Create unique key to avoid duplicates
      const key = `${date}-${descClean}-${amount}`;

      if (!isNaN(amount) && amount > 0 && descClean.length >= 2 && !seen.has(key)) {
        seen.add(key);

        const isDebit = amountStr.includes('-') ||
                        /withdrawal|debit|payment|purchase|fee|charge|sent|paid/i.test(descClean);

        transactions.push({
          date: date.trim(),
          description: descClean,
          amount: Math.abs(amount),
          type: isDebit ? 'debit' : 'credit',
          balance: balanceStr ? Math.abs(parseAmount(balanceStr)) : undefined,
        });
      }
    }
  }

  return transactions;
}

function parseRelaxed(lines: string[]): Transaction[] {
  const transactions: Transaction[] = [];

  // Look for any line containing a date and a dollar amount
  const datePattern = /\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]?\d{0,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}/i;
  const amountPattern = /-?\$?[\d,]+\.\d{2}/g;

  for (const line of lines) {
    const dateMatch = line.match(datePattern);
    if (!dateMatch) continue;

    // Find all amounts in the line
    const amounts = line.match(amountPattern);
    if (!amounts || amounts.length === 0) continue;

    // For 4-column format: first amount = transaction, last amount = balance
    const transactionAmountStr = amounts[0];
    const balanceStr = amounts.length > 1 ? amounts[amounts.length - 1] : undefined;

    const amount = parseAmount(transactionAmountStr);
    if (isNaN(amount) || amount === 0) continue;

    // Extract description: everything between date and first amount
    const dateIndex = line.indexOf(dateMatch[0]);
    const amountIndex = line.indexOf(transactionAmountStr);

    let description = '';
    if (amountIndex > dateIndex) {
      description = line.slice(dateIndex + dateMatch[0].length, amountIndex).trim();
    } else {
      description = line.slice(dateIndex + dateMatch[0].length).replace(amountPattern, '').trim();
    }

    description = description.replace(/\s+/g, ' ').trim();

    if (description.length < 2) continue;

    // Skip if description looks like headers
    if (/^(date|amount|balance|description|credit|debit)$/i.test(description)) continue;

    const isDebit = transactionAmountStr.includes('-') ||
                    /withdrawal|debit|payment|purchase|fee|charge|sent|paid/i.test(description);

    transactions.push({
      date: dateMatch[0],
      description,
      amount: Math.abs(amount),
      type: isDebit ? 'debit' : 'credit',
      balance: balanceStr ? Math.abs(parseAmount(balanceStr)) : undefined,
    });
  }

  return transactions;
}

function parseAmount(amountStr: string): number {
  if (!amountStr) return NaN;
  const cleaned = amountStr.replace(/[$,\s]/g, '');
  return parseFloat(cleaned);
}

function extractAccountInfo(text: string): ParsedStatement['accountInfo'] {
  const info: ParsedStatement['accountInfo'] = {};

  const accountMatch = text.match(/(?:Account|Acct|A\/C)[\s#:]*(\d{4,}[\d\-\*]*\d{4})/i);
  if (accountMatch) {
    info.accountNumber = accountMatch[1];
  }

  const periodMatch = text.match(/(?:Statement Period|Period|From)[\s:]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s*(?:to|through|-)\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
  if (periodMatch) {
    info.statementPeriod = `${periodMatch[1]} - ${periodMatch[2]}`;
  }

  return Object.keys(info).length > 0 ? info : undefined;
}
