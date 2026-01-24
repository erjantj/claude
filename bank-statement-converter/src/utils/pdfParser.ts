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

  // Multiple date and amount patterns for different bank formats
  const patterns = [
    // MM/DD/YYYY or MM-DD-YYYY with description and amounts
    /^(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s+(.+?)\s+(-?\$?[\d,]+\.\d{2})\s*(-?\$?[\d,]+\.\d{2})?$/,
    // DD/MM/YYYY format
    /^(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s+(.+?)\s+(-?\$?[\d,]+\.\d{2})$/,
    // Date at start, amounts at end (flexible middle)
    /^(\d{1,2}[\/\-]\d{1,2}[\/\-]?\d{0,4})\s+(.{3,}?)\s{2,}(-?\$?[\d,]+\.\d{2})\s*(-?\$?[\d,]+\.\d{2})?$/,
    // Mon DD format (Jan 15, Feb 03, etc.)
    /^((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{2,4})?)\s+(.+?)\s+(-?\$?[\d,]+\.\d{2})\s*(-?\$?[\d,]+\.\d{2})?$/i,
    // DD Mon YYYY format
    /^(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{2,4})\s+(.+?)\s+(-?\$?[\d,]+\.\d{2})\s*(-?\$?[\d,]+\.\d{2})?$/i,
    // YYYY-MM-DD format
    /^(\d{4}-\d{2}-\d{2})\s+(.+?)\s+(-?\$?[\d,]+\.\d{2})\s*(-?\$?[\d,]+\.\d{2})?$/,
    // Just date and amounts with description in middle (more relaxed)
    /(\d{1,2}[\/\-]\d{1,2}[\/\-]?\d{0,4})\s+(.{2,}?)\s+(-?\$?[\d,]+\.\d{2})/,
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match) {
      const [, date, description, amountStr, balanceStr] = match;
      const amount = parseAmount(amountStr);
      const descClean = description.trim().replace(/\s+/g, ' ');

      // Validate: amount should be reasonable, description should have some text
      if (!isNaN(amount) && amount > 0 && descClean.length >= 2) {
        const isDebit = amountStr.includes('-') ||
                        /withdrawal|debit|payment|purchase|fee|charge/i.test(descClean);

        return {
          date: date.trim(),
          description: descClean,
          amount: Math.abs(amount),
          type: isDebit ? 'debit' : 'credit',
          balance: balanceStr ? parseAmount(balanceStr) : undefined,
        };
      }
    }
  }

  return null;
}

function parseWithPatterns(text: string): Transaction[] {
  const transactions: Transaction[] = [];
  const seen = new Set<string>();

  // Multiple global patterns
  const patterns = [
    // Standard date format with amounts
    /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s+([A-Za-z][^$\d]*?)\s+(-?\$?[\d,]+\.\d{2})/g,
    // Mon DD format
    /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{2,4})?)\s+([A-Za-z][^$\d]*?)\s+(-?\$?[\d,]+\.\d{2})/gi,
    // More relaxed: any date-like pattern followed by text and amount
    /(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]?\d{0,4})\s+(.{3,50}?)\s+(-?\$?[\d,]+\.\d{2})/g,
  ];

  for (const pattern of patterns) {
    let match;
    // Reset regex
    pattern.lastIndex = 0;

    while ((match = pattern.exec(text)) !== null) {
      const [, date, description, amountStr] = match;
      const amount = parseAmount(amountStr);
      const descClean = description.trim().replace(/\s+/g, ' ');

      // Create unique key to avoid duplicates
      const key = `${date}-${descClean}-${amount}`;

      if (!isNaN(amount) && amount > 0 && descClean.length >= 2 && !seen.has(key)) {
        seen.add(key);

        const isDebit = amountStr.includes('-') ||
                        /withdrawal|debit|payment|purchase|fee|charge/i.test(descClean);

        transactions.push({
          date: date.trim(),
          description: descClean,
          amount: Math.abs(amount),
          type: isDebit ? 'debit' : 'credit',
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

    // Get the primary amount (usually first or the one that's negative)
    let primaryAmount = amounts[0];
    for (const amt of amounts) {
      if (amt.includes('-')) {
        primaryAmount = amt;
        break;
      }
    }

    const amount = parseAmount(primaryAmount);
    if (isNaN(amount) || amount === 0) continue;

    // Extract description: everything between date and amount
    const dateIndex = line.indexOf(dateMatch[0]);
    const amountIndex = line.indexOf(primaryAmount);

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

    const isDebit = primaryAmount.includes('-') ||
                    /withdrawal|debit|payment|purchase|fee|charge/i.test(description);

    transactions.push({
      date: dateMatch[0],
      description,
      amount: Math.abs(amount),
      type: isDebit ? 'debit' : 'credit',
      balance: amounts.length > 1 ? parseAmount(amounts[amounts.length - 1]) : undefined,
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
