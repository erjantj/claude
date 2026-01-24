export interface Transaction {
  date: string;
  description: string;
  amount: number;
  type: 'credit' | 'debit';
  balance?: number;
}

export interface ParsedStatement {
  transactions: Transaction[];
  accountInfo?: {
    accountNumber?: string;
    accountHolder?: string;
    bankName?: string;
    statementPeriod?: string;
  };
}
