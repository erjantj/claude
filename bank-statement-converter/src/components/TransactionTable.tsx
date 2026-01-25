import type { Transaction, StatementSection } from '../types/transaction';
import './TransactionTable.css';

interface TransactionTableProps {
  transactions: Transaction[];
  sections: StatementSection[];
}

export function TransactionTable({ transactions, sections }: TransactionTableProps) {
  if (transactions.length === 0) {
    return (
      <div className="no-transactions">
        <p>No transactions found in the PDF.</p>
        <p className="hint">
          Try uploading a different bank statement or check if the PDF contains transaction data.
        </p>
      </div>
    );
  }

  const formatAmount = (amount: number, type: 'credit' | 'debit') => {
    const formatted = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
    return type === 'debit' ? `-${formatted}` : formatted;
  };

  const hasBalance = transactions.some((t) => t.balance !== undefined);

  // If we have multiple sections, display grouped by section
  if (sections.length > 1) {
    return (
      <div className="sections-container">
        {sections.map((section, sectionIndex) => (
          <div key={sectionIndex} className="section">
            <h3 className="section-title">{section.name}</h3>
            <div className="table-container">
              <table className="transaction-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Type</th>
                    <th className="amount-col">Amount</th>
                    {hasBalance && <th className="amount-col">Balance</th>}
                  </tr>
                </thead>
                <tbody>
                  {section.transactions.map((transaction, index) => (
                    <tr key={index}>
                      <td className="date-cell">{transaction.date}</td>
                      <td className="description-cell">{transaction.description}</td>
                      <td>
                        <span className={`type-badge ${transaction.type}`}>
                          {transaction.type}
                        </span>
                      </td>
                      <td className={`amount-cell ${transaction.type}`}>
                        {formatAmount(transaction.amount, transaction.type)}
                      </td>
                      {hasBalance && (
                        <td className="amount-cell">
                          {transaction.balance !== undefined
                            ? new Intl.NumberFormat('en-US', {
                                style: 'currency',
                                currency: 'USD',
                              }).format(transaction.balance)
                            : '-'}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Single section or no sections - display flat table
  return (
    <div className="table-container">
      <table className="transaction-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Description</th>
            <th>Type</th>
            <th className="amount-col">Amount</th>
            {hasBalance && <th className="amount-col">Balance</th>}
          </tr>
        </thead>
        <tbody>
          {transactions.map((transaction, index) => (
            <tr key={index}>
              <td className="date-cell">{transaction.date}</td>
              <td className="description-cell">{transaction.description}</td>
              <td>
                <span className={`type-badge ${transaction.type}`}>
                  {transaction.type}
                </span>
              </td>
              <td className={`amount-cell ${transaction.type}`}>
                {formatAmount(transaction.amount, transaction.type)}
              </td>
              {hasBalance && (
                <td className="amount-cell">
                  {transaction.balance !== undefined
                    ? new Intl.NumberFormat('en-US', {
                        style: 'currency',
                        currency: 'USD',
                      }).format(transaction.balance)
                    : '-'}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
