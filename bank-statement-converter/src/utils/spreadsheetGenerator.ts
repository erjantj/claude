import * as XLSX from 'xlsx';
import type { Transaction, ParsedStatement } from '../types/transaction';

export type ExportFormat = 'xlsx' | 'csv';

export function generateSpreadsheet(
  data: ParsedStatement,
  format: ExportFormat = 'xlsx'
): void {
  const { transactions, accountInfo } = data;

  // Create workbook
  const wb = XLSX.utils.book_new();

  // Prepare transaction data for the sheet
  const sheetData = transactions.map((t) => ({
    Date: t.date,
    Description: t.description,
    Type: t.type.charAt(0).toUpperCase() + t.type.slice(1),
    Amount: t.amount,
    Balance: t.balance ?? '',
  }));

  // Create transactions sheet
  const ws = XLSX.utils.json_to_sheet(sheetData);

  // Set column widths
  ws['!cols'] = [
    { wch: 12 },  // Date
    { wch: 40 },  // Description
    { wch: 8 },   // Type
    { wch: 12 },  // Amount
    { wch: 12 },  // Balance
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Transactions');

  // Add summary sheet if we have account info
  if (accountInfo || transactions.length > 0) {
    const summaryData = [];

    if (accountInfo?.accountNumber) {
      summaryData.push({ Field: 'Account Number', Value: accountInfo.accountNumber });
    }
    if (accountInfo?.statementPeriod) {
      summaryData.push({ Field: 'Statement Period', Value: accountInfo.statementPeriod });
    }
    if (accountInfo?.accountHolder) {
      summaryData.push({ Field: 'Account Holder', Value: accountInfo.accountHolder });
    }
    if (accountInfo?.bankName) {
      summaryData.push({ Field: 'Bank', Value: accountInfo.bankName });
    }

    // Add transaction summary
    const totalCredits = transactions
      .filter((t) => t.type === 'credit')
      .reduce((sum, t) => sum + t.amount, 0);
    const totalDebits = transactions
      .filter((t) => t.type === 'debit')
      .reduce((sum, t) => sum + t.amount, 0);

    summaryData.push({ Field: '', Value: '' });
    summaryData.push({ Field: 'Total Transactions', Value: transactions.length });
    summaryData.push({ Field: 'Total Credits', Value: totalCredits.toFixed(2) });
    summaryData.push({ Field: 'Total Debits', Value: totalDebits.toFixed(2) });
    summaryData.push({ Field: 'Net Change', Value: (totalCredits - totalDebits).toFixed(2) });

    if (summaryData.length > 0) {
      const summaryWs = XLSX.utils.json_to_sheet(summaryData);
      summaryWs['!cols'] = [{ wch: 20 }, { wch: 30 }];
      XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');
    }
  }

  // Generate filename
  const timestamp = new Date().toISOString().split('T')[0];
  const filename = `bank_statement_${timestamp}.${format}`;

  // Write and download
  if (format === 'csv') {
    XLSX.writeFile(wb, filename, { bookType: 'csv' });
  } else {
    XLSX.writeFile(wb, filename, { bookType: 'xlsx' });
  }
}

export function getTransactionStats(transactions: Transaction[]) {
  const totalCredits = transactions
    .filter((t) => t.type === 'credit')
    .reduce((sum, t) => sum + t.amount, 0);

  const totalDebits = transactions
    .filter((t) => t.type === 'debit')
    .reduce((sum, t) => sum + t.amount, 0);

  return {
    totalTransactions: transactions.length,
    totalCredits,
    totalDebits,
    netChange: totalCredits - totalDebits,
    creditCount: transactions.filter((t) => t.type === 'credit').length,
    debitCount: transactions.filter((t) => t.type === 'debit').length,
  };
}
