export interface Transaction {
  date: string;
  description: string;
  amount: number;
  type: 'credit' | 'debit';
  balance?: number;
  section?: string;  // The statement section this transaction belongs to
}

export interface StatementSection {
  name: string;
  transactions: Transaction[];
}

export interface ParsedStatement {
  transactions: Transaction[];
  sections: StatementSection[];
  accountInfo?: {
    accountNumber?: string;
    accountHolder?: string;
    bankName?: string;
    statementPeriod?: string;
  };
}
