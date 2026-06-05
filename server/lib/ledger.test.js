import { describe, it, expect } from 'vitest';
import { sumDebits, sumCredits, isBalanced, assertBalanced, debitAccountFor, grossSalesAmount, suggestedSettleAccount, SETTLE_DESTINATIONS } from './ledger.js';

describe('ledger.sumDebits / sumCredits', () => {
  it('sums debit and credit columns independently', () => {
    const lines = [
      { debit: 100, credit: 0 },
      { debit: 50,  credit: 0 },
      { debit: 0,   credit: 150 }
    ];
    expect(sumDebits(lines)).toBe(150);
    expect(sumCredits(lines)).toBe(150);
  });
  it('treats missing debit/credit as zero', () => {
    expect(sumDebits([{ credit: 10 }, {}])).toBe(0);
    expect(sumCredits([{ debit: 10 }, {}])).toBe(0);
  });
});

describe('ledger.isBalanced', () => {
  it('returns true when DR == CR', () => {
    expect(isBalanced([{ debit: 100, credit: 0 }, { debit: 0, credit: 100 }])).toBe(true);
  });
  it('returns true within rounding tolerance', () => {
    expect(isBalanced([{ debit: 100.001, credit: 0 }, { debit: 0, credit: 100 }])).toBe(true);
  });
  it('returns false when out of balance beyond tolerance', () => {
    expect(isBalanced([{ debit: 100, credit: 0 }, { debit: 0, credit: 99 }])).toBe(false);
  });
});

describe('ledger.assertBalanced', () => {
  it('does not throw on balanced entries', () => {
    expect(() => assertBalanced([{ debit: 50, credit: 0 }, { debit: 0, credit: 50 }])).not.toThrow();
  });
  it('throws with context on unbalanced entries', () => {
    expect(() => assertBalanced([{ debit: 100, credit: 0 }], 'ORD-001')).toThrowError(/UNBALANCED.*ORD-001/);
  });
});

describe('ledger.debitAccountFor (Non-Cash → A/R policy)', () => {
  it('only Cash hits 1000 Cash on Hand immediately', () => {
    expect(debitAccountFor('Cash').code).toBe('1000');
  });
  it('Bank Transfer books as A/R until settled', () => {
    expect(debitAccountFor('Bank Transfer').code).toBe('1200');
  });
  it('All e-wallet variants book as A/R until settled', () => {
    expect(debitAccountFor('GCash').code).toBe('1200');
    expect(debitAccountFor('Maya').code).toBe('1200');
    expect(debitAccountFor('Maribank').code).toBe('1200');
    expect(debitAccountFor('E-Wallet').code).toBe('1200');
    expect(debitAccountFor('Other E-Wallet').code).toBe('1200');
  });
  it('Delivery partners book as A/R until settled', () => {
    expect(debitAccountFor('Grab Delivery').code).toBe('1200');
    expect(debitAccountFor('Foodpanda').code).toBe('1200');
    expect(debitAccountFor('Manual Delivery').code).toBe('1200');
  });
  it('Unknown payment methods default to A/R (safe — requires explicit settlement)', () => {
    expect(debitAccountFor('Bitcoin').code).toBe('1200');
  });
});

describe('ledger.suggestedSettleAccount', () => {
  it('Cash → 1000 Cash on Hand', () => {
    expect(suggestedSettleAccount('Cash').code).toBe('1000');
  });
  it('Bank Transfer → 1010 Cash in Bank', () => {
    expect(suggestedSettleAccount('Bank Transfer').code).toBe('1010');
  });
  it('All e-wallet variants → 1015 E-Wallet', () => {
    expect(suggestedSettleAccount('GCash').code).toBe('1015');
    expect(suggestedSettleAccount('Maya').code).toBe('1015');
    expect(suggestedSettleAccount('Maribank').code).toBe('1015');
    expect(suggestedSettleAccount('Other E-Wallet').code).toBe('1015');
  });
  it('Delivery partners → 1010 Cash in Bank (typical payout)', () => {
    expect(suggestedSettleAccount('Grab Delivery').code).toBe('1010');
    expect(suggestedSettleAccount('Foodpanda').code).toBe('1010');
    expect(suggestedSettleAccount('Manual Delivery').code).toBe('1010');
  });
  it('Unknown method → 1000 fallback', () => {
    expect(suggestedSettleAccount('Bitcoin').code).toBe('1000');
  });
});

describe('SETTLE_DESTINATIONS chart-of-accounts integrity', () => {
  it('contains 1000, 1010, 1015 — and only those', () => {
    const codes = SETTLE_DESTINATIONS.map(d => d.code).sort();
    expect(codes).toEqual(['1000', '1010', '1015']);
  });
});

describe('ledger.grossSalesAmount (Non-VAT)', () => {
  it('equals total + discount given (no VAT separation)', () => {
    expect(grossSalesAmount({ total: 900, discount: 100 })).toBe(1000);
  });
  it('handles missing discount', () => {
    expect(grossSalesAmount({ total: 250 })).toBe(250);
  });
  it('handles zero values', () => {
    expect(grossSalesAmount({ total: 0, discount: 0 })).toBe(0);
  });
});

describe('integration: a typical Non-VAT cash sale journal entry', () => {
  it('produces a balanced entry', () => {
    // ₱500 cash sale, ₱50 discount, ₱150 COGS
    const order = { total: 450, discount: 50, paymentMethod: 'Cash' };
    const cogs = 150;
    const debitAcct = debitAccountFor(order.paymentMethod);
    const gross = grossSalesAmount(order);

    const lines = [
      { accountCode: debitAcct.code, accountName: debitAcct.name, debit: order.total, credit: 0 },
      { accountCode: '4150', accountName: 'Sales Discounts', debit: order.discount, credit: 0 },
      { accountCode: '4000', accountName: 'Sales Revenue (Non-VAT)', debit: 0, credit: gross },
      { accountCode: '5000', accountName: 'COGS', debit: cogs, credit: 0 },
      { accountCode: '1500', accountName: 'Inventory Asset', debit: 0, credit: cogs }
    ];

    expect(isBalanced(lines)).toBe(true);
    expect(() => assertBalanced(lines, 'cash-sale-test')).not.toThrow();
  });
});
