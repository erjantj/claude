import * as XLSX from 'xlsx';
import type { Transaction, ParsedStatement } from '../types/transaction';

export type ExportFormat = 'xlsx' | 'csv';

export function generateSpreadsheet(
  data: ParsedStatement,
  format: ExportFormat = 'xlsx'
): void {
  const { transactions, sections, accountInfo } = data;

  // Create workbook
  const wb = XLSX.utils.book_new();

  // If we have multiple sections, create a sheet for each
  if (sections && sections.length > 1) {
    // First add "All Transactions" sheet
    const allSheetData = transactions.map((t) => ({
      Section: t.section || 'General',
      Date: t.date,
      Description: t.description,
      Type: t.type.charAt(0).toUpperCase() + t.type.slice(1),
      Amount: t.amount,
      Balance: t.balance ?? '',
    }));

    const allWs = XLSX.utils.json_to_sheet(allSheetData);
    allWs['!cols'] = [
      { wch: 20 },  // Section
      { wch: 12 },  // Date
      { wch: 40 },  // Description
      { wch: 8 },   // Type
      { wch: 12 },  // Amount
      { wch: 12 },  // Balance
    ];
    XLSX.utils.book_append_sheet(wb, allWs, 'All Transactions');

    // Add a sheet for each section
    for (const section of sections) {
      const sectionSheetData = section.transactions.map((t) => ({
        Date: t.date,
        Description: t.description,
        Type: t.type.charAt(0).toUpperCase() + t.type.slice(1),
        Amount: t.amount,
        Balance: t.balance ?? '',
      }));

      const sectionWs = XLSX.utils.json_to_sheet(sectionSheetData);
      sectionWs['!cols'] = [
        { wch: 12 },  // Date
        { wch: 40 },  // Description
        { wch: 8 },   // Type
        { wch: 12 },  // Amount
        { wch: 12 },  // Balance
      ];

      // Sanitize sheet name (max 31 chars, no special chars)
      const sheetName = section.name
        .replace(/[\\\/\*\?\[\]:]/g, '')
        .substring(0, 31);

      XLSX.utils.book_append_sheet(wb, sectionWs, sheetName || 'Section');
    }
  } else {
    // Single section or no sections - flat table
    const sheetData = transactions.map((t) => ({
      Date: t.date,
      Description: t.description,
      Type: t.type.charAt(0).toUpperCase() + t.type.slice(1),
      Amount: t.amount,
      Balance: t.balance ?? '',
    }));

    const ws = XLSX.utils.json_to_sheet(sheetData);
    ws['!cols'] = [
      { wch: 12 },  // Date
      { wch: 40 },  // Description
      { wch: 8 },   // Type
      { wch: 12 },  // Amount
      { wch: 12 },  // Balance
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Transactions');
  }

  // Add summary sheet
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

    // Overall summary
    const totalCredits = transactions
      .filter((t) => t.type === 'credit')
      .reduce((sum, t) => sum + t.amount, 0);
    const totalDebits = transactions
      .filter((t) => t.type === 'debit')
      .reduce((sum, t) => sum + t.amount, 0);

    summaryData.push({ Field: '', Value: '' });
    summaryData.push({ Field: '--- Overall Summary ---', Value: '' });
    summaryData.push({ Field: 'Total Transactions', Value: transactions.length });
    summaryData.push({ Field: 'Total Credits', Value: totalCredits.toFixed(2) });
    summaryData.push({ Field: 'Total Debits', Value: totalDebits.toFixed(2) });
    summaryData.push({ Field: 'Net Change', Value: (totalCredits - totalDebits).toFixed(2) });

    // Per-section summary if multiple sections
    if (sections && sections.length > 1) {
      for (const section of sections) {
        const sectionCredits = section.transactions
          .filter((t) => t.type === 'credit')
          .reduce((sum, t) => sum + t.amount, 0);
        const sectionDebits = section.transactions
          .filter((t) => t.type === 'debit')
          .reduce((sum, t) => sum + t.amount, 0);

        summaryData.push({ Field: '', Value: '' });
        summaryData.push({ Field: `--- ${section.name} ---`, Value: '' });
        summaryData.push({ Field: 'Transactions', Value: section.transactions.length });
        summaryData.push({ Field: 'Credits', Value: sectionCredits.toFixed(2) });
        summaryData.push({ Field: 'Debits', Value: sectionDebits.toFixed(2) });
        summaryData.push({ Field: 'Net', Value: (sectionCredits - sectionDebits).toFixed(2) });
      }
    }

    if (summaryData.length > 0) {
      const summaryWs = XLSX.utils.json_to_sheet(summaryData);
      summaryWs['!cols'] = [{ wch: 25 }, { wch: 30 }];
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
