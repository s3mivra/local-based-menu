import { describe, it, expect } from 'vitest';
import {
  ACCOUNTS,
  EXPENSE_CATEGORIES,
  getAccount,
  isAssetCode,
  isLiabilityCode,
  isEquityCode,
  isRevenueCode,
  isExpenseCode,
} from './chartOfAccounts.js';

describe('chartOfAccounts.ACCOUNTS coverage', () => {
  it('defines all five account types', () => {
    const types = new Set(Object.values(ACCOUNTS).map(a => a.type));
    expect(types.has('asset')).toBe(true);
    expect(types.has('liability')).toBe(true);
    expect(types.has('equity')).toBe(true);
    expect(types.has('revenue')).toBe(true);
    expect(types.has('expense')).toBe(true);
  });
  it('marks COGS account with cogs: true', () => {
    expect(ACCOUNTS['5000'].cogs).toBe(true);
  });
  it('marks Sales Discounts as contra-revenue', () => {
    expect(ACCOUNTS['4150'].type).toBe('contra-revenue');
  });
  it('Non-VAT-specific account exists', () => {
    expect(ACCOUNTS['4000'].name).toMatch(/Non-VAT/);
  });
});

describe('chartOfAccounts code-range classifiers', () => {
  it('1xxx codes are assets', () => {
    ['1000', '1010', '1015', '1200', '1500'].forEach(code => {
      expect(isAssetCode(code)).toBe(true);
      expect(ACCOUNTS[code].type).toBe('asset');
    });
  });
  it('2xxx codes are liabilities', () => {
    ['2000', '2200', '2300'].forEach(code => {
      expect(isLiabilityCode(code)).toBe(true);
      expect(ACCOUNTS[code].type).toBe('liability');
    });
  });
  it('3xxx codes are equity', () => {
    ['3000', '3100', '3900'].forEach(code => {
      expect(isEquityCode(code)).toBe(true);
      expect(ACCOUNTS[code].type).toBe('equity');
    });
  });
  it('4xxx codes are revenue or contra-revenue', () => {
    expect(isRevenueCode('4000')).toBe(true);
    expect(isRevenueCode('4020')).toBe(true);
    expect(isRevenueCode('4150')).toBe(true);
    expect(isRevenueCode('4200')).toBe(true);
  });
  it('5xxx and 6xxx codes are expenses', () => {
    ['5000', '5010', '5100', '5300'].forEach(c => expect(isExpenseCode(c)).toBe(true));
    ['6000', '6010', '6020', '6030', '6040', '6050', '6060', '6090'].forEach(c => expect(isExpenseCode(c)).toBe(true));
  });
  it('classifiers are mutually exclusive', () => {
    for (const code of Object.keys(ACCOUNTS)) {
      const hits = [isAssetCode, isLiabilityCode, isEquityCode, isRevenueCode, isExpenseCode]
        .filter(fn => fn(code)).length;
      expect(hits).toBe(1);
    }
  });
});

describe('chartOfAccounts.getAccount', () => {
  it('returns the canonical entry for a known code', () => {
    expect(getAccount('1000').name).toBe('Cash on Hand');
  });
  it('returns a fallback for unknown codes', () => {
    const acct = getAccount('9999');
    expect(acct.name).toMatch(/9999/);
    expect(acct.type).toBe('unknown');
  });
});

describe('EXPENSE_CATEGORIES integrity', () => {
  it('every category code exists in ACCOUNTS', () => {
    for (const cat of EXPENSE_CATEGORIES) {
      expect(ACCOUNTS[cat.code]).toBeDefined();
      expect(ACCOUNTS[cat.code].type).toBe('expense');
    }
  });
  it('all category codes start with 6', () => {
    for (const cat of EXPENSE_CATEGORIES) {
      expect(cat.code.startsWith('6')).toBe(true);
    }
  });
  it('has at least 8 operator-facing categories', () => {
    expect(EXPENSE_CATEGORIES.length).toBeGreaterThanOrEqual(8);
  });
  it('every label is non-empty', () => {
    for (const cat of EXPENSE_CATEGORIES) {
      expect(typeof cat.label).toBe('string');
      expect(cat.label.length).toBeGreaterThan(0);
    }
  });
});

describe('Non-VAT compliance check', () => {
  it('does not include any VAT Payable account', () => {
    expect(ACCOUNTS['2100']).toBeUndefined();
    for (const [, meta] of Object.entries(ACCOUNTS)) {
      expect(meta.name.toLowerCase()).not.toMatch(/vat payable/);
    }
  });
});
