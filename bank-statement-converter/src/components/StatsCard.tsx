import type { Transaction } from '../types/transaction';
import { getTransactionStats } from '../utils/spreadsheetGenerator';
import './StatsCard.css';

interface StatsCardProps {
  transactions: Transaction[];
}

export function StatsCard({ transactions }: StatsCardProps) {
  const stats = getTransactionStats(transactions);

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);

  return (
    <div className="stats-grid">
      <div className="stat-card">
        <span className="stat-label">Total Transactions</span>
        <span className="stat-value">{stats.totalTransactions}</span>
      </div>
      <div className="stat-card">
        <span className="stat-label">Credits ({stats.creditCount})</span>
        <span className="stat-value credit">{formatCurrency(stats.totalCredits)}</span>
      </div>
      <div className="stat-card">
        <span className="stat-label">Debits ({stats.debitCount})</span>
        <span className="stat-value debit">{formatCurrency(stats.totalDebits)}</span>
      </div>
      <div className="stat-card">
        <span className="stat-label">Net Change</span>
        <span className={`stat-value ${stats.netChange >= 0 ? 'credit' : 'debit'}`}>
          {formatCurrency(stats.netChange)}
        </span>
      </div>
    </div>
  );
}
