// Canonical Chart of Accounts — Non-VAT SME
// Used to classify accounts for P&L / Balance Sheet reports.

export const ACCOUNTS = {
  // ===== ASSETS (1xxx) =====
  '1000': { name: 'Cash on Hand',         type: 'asset' },
  '1010': { name: 'Cash in Bank',         type: 'asset' },
  '1015': { name: 'E-Wallet',             type: 'asset' },
  '1050': { name: 'Petty Cash / Revolving Fund', type: 'asset' },
  '1200': { name: 'Accounts Receivable',  type: 'asset' },
  '1500': { name: 'Inventory Asset',      type: 'asset' },

  // ===== LIABILITIES (2xxx) =====
  '2000': { name: 'Accounts Payable',     type: 'liability' },
  '2200': { name: 'Salaries Payable',     type: 'liability' },
  '2300': { name: 'Utilities Payable',    type: 'liability' },

  // ===== EQUITY (3xxx) =====
  '3000': { name: "Owner's Capital",      type: 'equity' },
  '3100': { name: "Owner's Drawing",      type: 'equity' },
  '3900': { name: 'Retained Earnings',    type: 'equity' },

  // ===== REVENUE (4xxx) =====
  '4000': { name: 'Sales Revenue (Non-VAT)',     type: 'revenue' },
  '4020': { name: 'Cash Short & Over Income',    type: 'revenue' },
  '4150': { name: 'Sales Discounts',             type: 'contra-revenue' },
  '4200': { name: 'Inventory Adjustment Gain',   type: 'revenue' },

  // ===== EXPENSES (5xxx COGS / 6xxx Operating) =====
  '5000': { name: 'Cost of Goods Sold',                type: 'expense', cogs: true },
  '5010': { name: 'Cash Short & Over Expense',         type: 'expense' },
  '5100': { name: 'Spoilage, Variance & Waste Expense', type: 'expense' },
  '5300': { name: 'Complimentary Expense',             type: 'expense' },

  '6000': { name: 'Rent Expense',                      type: 'expense' },
  '6010': { name: 'Utilities Expense',                 type: 'expense' },
  '6020': { name: 'Salaries Expense',                  type: 'expense' },
  '6030': { name: 'Supplies Expense',                  type: 'expense' },
  '6040': { name: 'Marketing Expense',                 type: 'expense' },
  '6050': { name: 'Repairs & Maintenance',             type: 'expense' },
  '6060': { name: 'Bank Charges',                      type: 'expense' },
  '6090': { name: 'Other Operating Expenses',          type: 'expense' },
};

// Operator-facing expense categories (used by Expense entry form)
export const EXPENSE_CATEGORIES = [
  { code: '6000', label: 'Rent' },
  { code: '6010', label: 'Utilities (Electricity / Water / Internet)' },
  { code: '6020', label: 'Salaries & Wages' },
  { code: '6030', label: 'Supplies (Non-Inventory)' },
  { code: '6040', label: 'Marketing & Advertising' },
  { code: '6050', label: 'Repairs & Maintenance' },
  { code: '6060', label: 'Bank Charges' },
  { code: '6090', label: 'Other Operating Expense' },
];

export function getAccount(code) {
  return ACCOUNTS[code] || { name: `Account ${code}`, type: 'unknown' };
}

export function isAssetCode(code)     { return code?.startsWith('1'); }
export function isLiabilityCode(code) { return code?.startsWith('2'); }
export function isEquityCode(code)    { return code?.startsWith('3'); }
export function isRevenueCode(code)   { return code?.startsWith('4'); }
export function isExpenseCode(code)   { return code?.startsWith('5') || code?.startsWith('6'); }
