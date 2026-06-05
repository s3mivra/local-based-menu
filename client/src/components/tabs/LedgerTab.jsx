import React from 'react';
import { Menu, Maximize, Minimize, X, Lock, Unlock, QrCode, TrendingUp, TrendingDown, Package, Users, Settings, DollarSign, ShoppingCart, ChefHat, BarChart3, FileText, AlertCircle, AlertTriangle, Plus, Edit, Trash2, Eye, Download, RefreshCw, CheckCircle, Check, Clock, Coffee, Minus, LogOut, ChevronRight, ChevronLeft, ChevronDown, ChevronUp, Building2, Printer, ArrowUp, ArrowDown, Gift, XCircle, Zap, BarChart2, CreditCard, Banknote, Smartphone, Truck, Bell, ShieldCheck, Search, Tag } from 'lucide-react';
import { usePagination } from '../../lib/usePagination';
import Pager from '../Pager';

// ── LedgerTab — extracted from AdminDashboard.jsx ──
// All state and handlers come in via the `ctx` prop.
export default function LedgerTab({ ctx }) {
  // Destructure everything from ctx
  // ── Auto-generated from ctx — do NOT edit manually.
  // Run scripts_temp/fix_tab_destructures.cjs to regenerate.
  // ── Auto-generated from ctx — do NOT edit manually.
  // Run scripts_temp/fix_tab_destructures.cjs to regenerate.
  // ── Auto-generated from ctx — do NOT edit manually.
  // Run scripts_temp/fix_tab_destructures.cjs to regenerate.
  const {
    API_URL, AUDIT_PAGE_SIZE, BIZ_NAME, COMP_REASON_LABELS, FRONTEND_URL,
    HIST_PAGE_SIZE, POS_PER_PAGE, SHIFT_HIST_PAGE_SIZE, accountingItemsPerPage, accountingPage,
    activeAdmin, activeInventoryItem, activeTab, addInventory, addMaterialToRecipe,
    addOnForm, addSize, analyticsData, analyticsLoading, apiFetch,
    applyComplimentary, applyDiscount, applyItemDiscount, arOutstanding, archiveDay,
    archivedOrders, auditCancelPage, auditCompPage, auditDiscPage, auditFilter,
    auditStaffPage, bsData, calcRecipeCost, cashOnHand, cashTendered,
    catForm, categories, closeRfFund, collapsedOrders, compOverride,
    compReasonNotes, compReasonTypes, compSelections, confirmPosItem, currentEntries,
    currentInventory, currentOrders, currentPage, currentPricingProducts, currentProducts,
    dailyMovement, deleteAddOn, deleteCategory, deleteInventory, deleteProduct,
    departmentFilter, discountForm, discountInputs, discountList, discounts,
    displayOrders, downloadImportTemplate, downloadJournalCsv, editInvForm, editInvModal,
    editInvSubmitting, editPriceId, editPriceVal, editingCategory, editingProduct,
    effectiveDisplay, eodLockedAt, eodStatus, expandedBatchRows, expandedDays,
    expandedOrderLists, expenseCategories, expenseModal, exportAllToPDF, exportAnalyticsToPDF,
    exportDayToPDF, exportInventoryToPDF, exportLedgerToPDF, fetchAnalytics, fetchArOutstanding,
    fetchBalanceSheet, fetchData, fetchEODData, fetchERPData, fetchExpenseCategories,
    fetchOrders, fetchPnl, fetchRfFunds, fetchRfTxs, fetchShiftHistory,
    fetchStockHistory, filteredOrders, formData, getEstimatedStock, globalAddOns,
    groupedArchives, handleImageUpload, handleInlinePriceUpdate, handleRestockSubmit, handleSaveAddOn,
    handleSaveCategory, handleSaveProduct, handleVoidOrder, historyItemName, historyModalOpen,
    historyPage, historySubTab, importModal, importRows, importSubmitting,
    invBadgeCount, invForm, invItemsPerPage, invPage, invSubTab,
    inventory, isPosOpen, isStatusMenuOpen, isSuperAdmin, itemDisplay,
    itemsPerPage, jeForm, journalEntries, ledgerSubTab, navMode,
    newDiscount, openEditInventory, openProductModal, orderFilter, orders,
    ordersItemsPerPage, ordersPage, parseImportFile, paymentSelections, peso,
    physicalCounts, pnlData, pnlRange, posActiveAddOns, posActiveSize,
    posCart, posCashTendered, posCategory, posCheckoutModal, posCustomerName,
    posCustomerPhone, posDeliveryAddress, posDeliveryFee, posDeliveryFeeNum, posDiscountAmt,
    posDiscountType, posDiscountValue, posGrandTotal, posPage, posPayment,
    posScheduledTime, posSearch, posSelectedProduct, posSubtotal, posTable,
    pricingItemsPerPage, pricingPage, printOrderSlip, printXReading, products,
    removeAddOnFromOrder, removeComplimentary, removeMaterial, removeSize, restockData,
    rfActiveFund, rfDisbForm, rfDisbModal, rfDisbSubmitting, rfFunds,
    rfLoading, rfNewForm, rfNewModal, rfNewSubmitting, rfReplForm,
    rfReplModal, rfReplSubmitting, rfTxPage, rfTxPages, rfTxTotal,
    rfTxs, scpwdOpen, setAccountingPage, setActiveInventoryItem, setActiveTab,
    setAddOnForm, setAuditCancelPage, setAuditCompPage, setAuditDiscPage, setAuditFilter,
    setAuditStaffPage, setCashTendered, setCatForm, setCollapsedOrders, setCompOverride,
    setCompReasonNotes, setCompReasonTypes, setCompSelections, setCurrentPage, setDepartmentFilter,
    setDiscountForm, setDiscountInputs, setEditInvForm, setEditInvModal, setEditPriceId,
    setEditPriceVal, setEditingCategory, setEditingProduct, setExpandedBatchRows, setExpenseModal,
    setFormData, setHistoryItemName, setHistoryModalOpen, setHistoryPage, setHistorySubTab,
    setImportModal, setImportRows, setInvForm, setInvPage, setInvSubTab,
    setIsPosOpen, setIsStatusMenuOpen, setJeForm, setJournalEntries, setLedgerSubTab,
    setNewDiscount, setOrderFilter, setOrdersPage, setPaymentSelections, setPhysicalCounts,
    setPnlRange, setPosActiveAddOns, setPosActiveSize, setPosCart, setPosCashTendered,
    setPosCategory, setPosCheckoutModal, setPosCustomerName, setPosCustomerPhone, setPosDeliveryAddress,
    setPosDeliveryFee, setPosDiscountType, setPosDiscountValue, setPosPage, setPosPayment,
    setPosScheduledTime, setPosSearch, setPosSelectedProduct, setPosTable, setPricingPage,
    setRestockData, setRfActiveFund, setRfDisbForm, setRfDisbModal, setRfNewForm,
    setRfNewModal, setRfReplForm, setRfReplModal, setRfTxs, setScpwdOpen,
    setSettleForm, setSettleModal, setSettleSubmitting, setShiftFilter, setShiftHistoryPage,
    setSpoilageForm, setSpoilageModal, setStockHistory, setVarianceNoteMode, setVarianceReasons,
    settleForm, settleModal, settleSubmitting, shiftFilter, shiftHistory,
    shiftHistoryPage, shiftHistoryTotal, spoilageForm, spoilageLoading, spoilageModal,
    standardAccounts, stockHistory, submitManualOrder, submitPhysicalCounts, submitRfDisb,
    submitRfNew, submitRfRepl, toggleDay, toggleOrderList, toggleVat,
    totalAccountingPages, totalInvPages, totalOrdersPages, totalPages, totalPricingPages,
    updateItemStatus, updateMaterialQty, updateSize, updateStatus, updatingOrders,
    users, varianceNoteMode, varianceReasons,
    apData, fetchApData, apPayModal, setApPayModal, apPayForm, setApPayForm, apPaySubmitting, submitApPayment,
    profitByCategory, fetchProfitByCategory,
    salesByPayment, sbpRange, setSbpRange, fetchSalesByPayment,
    menuEngineering, fetchMenuEngineering, cashierVariance, fetchCashierVariance, purchaseOrder, fetchPurchaseOrder,
    exportPnlPDF, exportBalanceSheetPDF, exportPurchaseOrderPDF,
  } = ctx;

  // ── Report-table pagination (client-side, 10 rows/page) ──
  const arPage   = usePagination(arOutstanding?.orders, 10);
  const apPage   = usePagination(apData?.recent, 10);
  const sbpPage  = usePagination(salesByPayment?.breakdown, 10);
  const pbcPage  = usePagination(profitByCategory?.categories, 10);
  const mePage   = usePagination(menuEngineering?.items, 10);
  const cvPage   = usePagination(cashierVariance?.cashiers, 10);
  const poPage   = usePagination(purchaseOrder?.lines, 10);

  return (
        <div className="space-y-4">

          {/* SUB-TAB NAV */}
          <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-1 bg-surface border border-white/8 rounded-2xl p-2">
            {[
              ['journal',   'Journal',          FileText],
              ['pnl',       'Profit & Loss',    TrendingUp],
              ['balance',   'Balance Sheet',    BarChart2],
              ['ar',        'A/R Outstanding',  Truck],
              ['ap',        'A/P Payables',     CreditCard],
              ['payments',  'By Payment',       Banknote],
              ['profitcat', 'Profit by Cat.',   BarChart2],
              ['menueng',   'Menu Engineering', TrendingUp],
              ['variance',  'Cashier Variance', Users],
              ['po',        'Purchase Order',   Package],
              ['revolving', 'Revolving Funds',  RefreshCw],
              ['expenses',  'Add Expense',      Plus]
            ].map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => {
                  if (id === 'expenses') { fetchExpenseCategories(); setExpenseModal(true); return; }
                  setLedgerSubTab(id);
                  if (id === 'pnl' && !pnlData) fetchPnl();
                  if (id === 'balance' && !bsData) fetchBalanceSheet();
                  if (id === 'ar') fetchArOutstanding();
                  if (id === 'ap') fetchApData();
                  if (id === 'payments') fetchSalesByPayment();
                  if (id === 'profitcat') fetchProfitByCategory();
                  if (id === 'menueng') fetchMenuEngineering();
                  if (id === 'variance') fetchCashierVariance();
                  if (id === 'po') fetchPurchaseOrder();
                  if (id === 'revolving') { fetchRfFunds(); setRfActiveFund(null); setRfTxs([]); }
                }}
                className={`shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition min-h-[44px] ${ledgerSubTab === id && id !== 'expenses' ? 'bg-brand text-white shadow-elev-1' : 'bg-transparent text-white/50 hover:text-white hover:bg-white/5'}`}
              >
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>

          {ledgerSubTab === 'journal' && (
        <div className="flex flex-col xl:flex-row gap-8">

          {/* LEFT COLUMN: Balances & New Entry Form */}
          <div className="w-full xl:w-1/3 space-y-6">
            
            {/* --- LIVE CASH ON HAND --- */}
            <div className="bg-accent border border-accent/30 rounded-xl p-6 shadow-lg shadow-accent/5">
              <p className="text-white text-xs font-bold uppercase tracking-wider mb-1">Live Cash on Hand</p>
              <p className="text-4xl font-black text-white">P{cashOnHand.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>

            <div className="bg-surface border border-gray-800 rounded-xl p-6 h-fit">
              <h3 className="text-xl font-bold mb-4 text-accent border-b border-gray-800 pb-2">New Journal Entry</h3>
              <div className="space-y-4">
                <input type="text" placeholder="Description / Memo" value={jeForm.description} onChange={e => setJeForm({...jeForm, description: e.target.value})} className="w-full bg-page-bg border border-gray-700 rounded p-2 text-white outline-none" />
                {jeForm.lines.map((line, idx) => (
                  <div key={idx} className="bg-accent p-3 rounded border border-gray-700 space-y-2 relative">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold text-white/60">Line {idx + 1}</span>
                      <button
                        type="button"
                        aria-label={`Remove line ${idx + 1}`}
                        disabled={jeForm.lines.length <= 2}
                        title={jeForm.lines.length <= 2 ? 'A journal entry needs at least 2 lines' : 'Remove this line'}
                        onClick={() => setJeForm({ ...jeForm, lines: jeForm.lines.filter((_, i) => i !== idx) })}
                        className="text-white/60 hover:text-red-300 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <select value={line.accountCode} onChange={(e) => {
                      const acc = standardAccounts.find(a => a.accountCode === e.target.value);
                      const newLines = [...jeForm.lines];
                      newLines[idx] = { ...line, accountCode: acc.accountCode, accountName: acc.accountName };
                      setJeForm({...jeForm, lines: newLines});
                    }} className="w-full bg-page-bg border border-gray-600 rounded p-2 text-sm text-white">
                      <option value="">Select Account...</option>
                      {standardAccounts.map(acc => <option key={acc.accountCode} value={acc.accountCode}>{acc.accountCode} - {acc.accountName}</option>)}
                    </select>
                    <div className="flex gap-2">
                      <input type="number" placeholder="Debit" value={line.debit} onChange={e => { const nl = [...jeForm.lines]; nl[idx].debit = e.target.value; nl[idx].credit = ''; setJeForm({...jeForm, lines: nl}); }} className="w-1/2 bg-page-bg border border-gray-600 rounded p-2 text-sm text-white placeholder-gray-500" />
                      <input type="number" placeholder="Credit" value={line.credit} onChange={e => { const nl = [...jeForm.lines]; nl[idx].credit = e.target.value; nl[idx].debit = ''; setJeForm({...jeForm, lines: nl}); }} className="w-1/2 bg-page-bg border border-gray-600 rounded p-2 text-sm text-white placeholder-gray-500" />
                    </div>
                  </div>
                ))}
                <button onClick={() => setJeForm({...jeForm, lines: [...jeForm.lines, {accountCode:'', accountName:'', debit:'', credit:''}]})} className="text-xs text-accent hover:text-white">+ Add Line</button>
                <div className="border-t border-gray-800 pt-4 mt-4 flex justify-between items-center">
                  <div className="text-xs text-gray-400">
                    Debits: {jeForm.lines.reduce((s, l) => s + Number(l.debit||0), 0)} <br/>
                    Credits: {jeForm.lines.reduce((s, l) => s + Number(l.credit||0), 0)}
                  </div>
                  <button onClick={async () => {
                    await apiFetch(`/api/journal`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(jeForm) });
                    setJeForm({ description: '', lines: [{accountCode:'', accountName:'', debit:'', credit:''}, {accountCode:'', accountName:'', debit:'', credit:''}] });
                    fetchERPData();
                  }} className="bg-accent text-white font-bold py-2 px-4 rounded hover:bg-page-bg hover:text-accent transition shadow-lg shadow-accent/20">Post Entry</button>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: General Ledger */}
          <div className="flex-1 bg-surface border border-gray-800 rounded-xl p-6">
            <div className="flex justify-between items-center mb-4 border-b border-gray-800 pb-2">
              <h3 className="text-xl font-bold text-white">General Ledger</h3>
              <button onClick={exportLedgerToPDF} className="text-[10px] bg-accent border border-gray-600 text-gray-300 px-3 py-1.5 rounded hover:bg-page-bg hover:text-accent transition font-bold uppercase tracking-wider">
                Export Ledger
              </button>
            </div>
            <div className="space-y-4">
              {currentEntries.map(entry => (
                <div key={entry._id} className="bg-page-bg border border-gray-700 rounded-lg p-4">
                  <div className="flex justify-between items-center mb-3 border-b border-gray-800 pb-2">
                    <span className="text-accent font-bold">{entry.reference}</span>
                    <span className="text-white text-sm">{new Date(entry.date).toLocaleDateString()}</span>
                  </div>
                  <p className="text-sm text-white mb-3 font-semibold">{entry.description}</p>
                  <table className="w-full text-sm">
                    <thead><tr className="text-white text-left"><th className="pb-2">Account</th><th className="pb-2 text-right">Debit</th><th className="pb-2 text-right">Credit</th></tr></thead>
                    <tbody>
                      {entry.lines.map((line, idx) => (
                        <tr key={idx} className="border-t border-gray-800/50">
                          <td className={`py-1 ${line.credit > 0 ? 'pl-6 text-white' : 'text-gray-600'}`}>{line.accountCode} - {line.accountName}</td>
                          <td className="py-1 text-right text-gray-600">{line.debit > 0 ? line.debit.toFixed(2) : ''}</td>
                          <td className="py-1 text-right text-gray-600">{line.credit > 0 ? line.credit.toFixed(2) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
              {/* --- ACCOUNTING PAGINATION CONTROLS --- */}
              {totalAccountingPages > 1 && (
                <div className="flex justify-between items-center bg-page-bg p-3 rounded-lg border border-gray-800 mt-4">
                  <button 
                    onClick={() => setAccountingPage(prev => Math.max(prev - 1, 1))}
                    disabled={accountingPage === 1}
                    className={`px-4 py-1.5 rounded font-bold uppercase tracking-wider text-[10px] transition ${accountingPage === 1 ? 'bg-gray-800 text-gray-600 cursor-not-allowed' : 'bg-surface border border-gray-700 text-white hover:border-accent hover:text-accent'}`}
                  >
                    <span className="flex items-center gap-1"><ChevronLeft size={12} /> Prev</span>
                  </button>
                  <span className="text-gray-400 text-xs font-bold tracking-widest">
                    PAGE <span className="text-accent text-sm">{accountingPage}</span> OF {totalAccountingPages}
                  </span>
                  <button 
                    onClick={() => setAccountingPage(prev => Math.min(prev + 1, totalAccountingPages))}
                    disabled={accountingPage === totalAccountingPages}
                    className={`px-4 py-1.5 rounded font-bold uppercase tracking-wider text-[10px] transition ${accountingPage === totalAccountingPages ? 'bg-gray-800 text-gray-600 cursor-not-allowed' : 'bg-surface border border-gray-700 text-white hover:border-accent hover:text-accent'}`}
                  >
                    <span className="flex items-center gap-1">Next <ChevronRight size={12} /></span>
                  </button>
                </div>
              )}
            </div>
          </div>

        </div>
          )}

          {/* ===== PROFIT & LOSS SUB-TAB ===== */}
          {ledgerSubTab === 'pnl' && (
            <div className="bg-surface border border-white/8 rounded-2xl p-6 space-y-4 animate-fade-in">
              <div className="flex flex-col sm:flex-row sm:items-end gap-3 sm:justify-between border-b border-white/10 pb-4">
                <div>
                  <h3 className="text-2xl font-black text-white">Profit &amp; Loss Statement</h3>
                  <p className="text-white/40 text-xs font-bold uppercase tracking-widest mt-1">Non-VAT Registered</p>
                </div>
                <div className="flex flex-wrap gap-2 items-end">
                  <div>
                    <label className="text-[10px] text-white/40 font-bold uppercase block mb-1">Start</label>
                    <input type="date" value={pnlRange.start} onChange={e => setPnlRange({...pnlRange, start: e.target.value})} className="bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-white text-sm font-bold outline-none focus:border-brand/60" />
                  </div>
                  <div>
                    <label className="text-[10px] text-white/40 font-bold uppercase block mb-1">End</label>
                    <input type="date" value={pnlRange.end} onChange={e => setPnlRange({...pnlRange, end: e.target.value})} className="bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-white text-sm font-bold outline-none focus:border-brand/60" />
                  </div>
                  <button onClick={fetchPnl} className="bg-brand text-white px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider hover:bg-brand/90 transition min-h-[44px]">Run</button>
                  <button onClick={exportPnlPDF} className="bg-white/5 text-white/70 hover:text-white hover:bg-white/10 px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider transition min-h-[44px] flex items-center gap-1.5"><Download size={13}/> PDF</button>
                </div>
              </div>

              {!pnlData ? (
                <div className="py-16 text-center text-white/30 font-bold uppercase tracking-widest text-sm">Click "Run" to generate report</div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Revenue */}
                  <div className="space-y-3">
                    <h4 className="text-brand font-black text-sm uppercase tracking-widest border-b border-white/10 pb-2">Revenue</h4>
                    {pnlData.revenue.length === 0 ? <p className="text-white/30 text-sm">No revenue entries.</p> :
                      <table className="w-full text-sm">
                        <tbody>
                          {pnlData.revenue.map(r => (
                            <tr key={r.code} className="border-b border-white/5">
                              <td className="py-2 text-white/60 text-xs"><span className="text-white/30 mr-2">{r.code}</span>{r.name}</td>
                              <td className="py-2 text-right text-white tabular-nums font-bold">{r.amount >= 0 ? '' : '(' }₱{Math.abs(r.amount).toFixed(2)}{r.amount < 0 ? ')' : ''}</td>
                            </tr>
                          ))}
                          <tr><td className="pt-3 font-black text-white uppercase text-xs">Net Revenue</td><td className="pt-3 text-right text-brand tabular-nums font-black text-lg">₱{pnlData.totals.netRevenue.toFixed(2)}</td></tr>
                        </tbody>
                      </table>
                    }
                    <h4 className="text-orange-400 font-black text-sm uppercase tracking-widest border-b border-white/10 pb-2 mt-6">Cost of Goods Sold</h4>
                    {pnlData.cogs.length === 0 ? <p className="text-white/30 text-sm">No COGS entries.</p> :
                      <table className="w-full text-sm">
                        <tbody>
                          {pnlData.cogs.map(r => (
                            <tr key={r.code} className="border-b border-white/5">
                              <td className="py-2 text-white/60 text-xs"><span className="text-white/30 mr-2">{r.code}</span>{r.name}</td>
                              <td className="py-2 text-right text-white tabular-nums font-bold">₱{r.amount.toFixed(2)}</td>
                            </tr>
                          ))}
                          <tr><td className="pt-3 font-black text-white uppercase text-xs">Total COGS</td><td className="pt-3 text-right text-orange-400 tabular-nums font-black">₱{pnlData.totals.cogs.toFixed(2)}</td></tr>
                          <tr className="border-t border-white/10"><td className="pt-3 font-black text-white uppercase text-sm">Gross Profit</td><td className="pt-3 text-right text-green-400 tabular-nums font-black text-lg">₱{pnlData.totals.grossProfit.toFixed(2)}</td></tr>
                          <tr><td className="font-bold text-white/50 uppercase text-xs">Gross Margin</td><td className="text-right text-white/70 tabular-nums font-black text-sm">{pnlData.totals.grossMargin.toFixed(2)}%</td></tr>
                        </tbody>
                      </table>
                    }
                  </div>

                  {/* Operating Expenses */}
                  <div className="space-y-3">
                    <h4 className="text-red-400 font-black text-sm uppercase tracking-widest border-b border-white/10 pb-2">Operating Expenses</h4>
                    {pnlData.opex.length === 0 ? <p className="text-white/30 text-sm">No expense entries in this period.</p> :
                      <table className="w-full text-sm">
                        <tbody>
                          {pnlData.opex.map(r => (
                            <tr key={r.code} className="border-b border-white/5">
                              <td className="py-2 text-white/60 text-xs"><span className="text-white/30 mr-2">{r.code}</span>{r.name}</td>
                              <td className="py-2 text-right text-white tabular-nums font-bold">₱{r.amount.toFixed(2)}</td>
                            </tr>
                          ))}
                          <tr><td className="pt-3 font-black text-white uppercase text-xs">Total OpEx</td><td className="pt-3 text-right text-red-400 tabular-nums font-black">₱{pnlData.totals.opex.toFixed(2)}</td></tr>
                        </tbody>
                      </table>
                    }

                    {/* Net Income Summary */}
                    <div className={`mt-6 rounded-xl p-5 border ${pnlData.totals.netIncome >= 0 ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
                      <p className="text-white/60 text-xs font-black uppercase tracking-widest mb-2">Net Income</p>
                      <p className={`text-4xl font-black tabular-nums ${pnlData.totals.netIncome >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {pnlData.totals.netIncome < 0 ? '−' : ''}₱{Math.abs(pnlData.totals.netIncome).toFixed(2)}
                      </p>
                      <p className="text-white/40 text-xs font-bold mt-2">Net Margin: <span className="tabular-nums">{pnlData.totals.netMargin.toFixed(2)}%</span></p>
                      <p className="text-white/30 text-[10px] font-bold uppercase tracking-widest mt-3 border-t border-white/10 pt-2">
                        Period: {new Date(pnlData.period.start).toLocaleDateString()} → {new Date(pnlData.period.end).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ===== BALANCE SHEET SUB-TAB ===== */}
          {ledgerSubTab === 'balance' && (
            <div className="bg-surface border border-white/8 rounded-2xl p-6 space-y-4 animate-fade-in">
              <div className="flex justify-between items-end border-b border-white/10 pb-4">
                <div>
                  <h3 className="text-2xl font-black text-white">Balance Sheet</h3>
                  <p className="text-white/40 text-xs font-bold uppercase tracking-widest mt-1">Snapshot as of {bsData ? new Date(bsData.asOf).toLocaleDateString() : 'today'}</p>
                </div>
                <div className="flex gap-2">
                  {bsData && <button onClick={exportBalanceSheetPDF} className="bg-white/5 text-white/70 hover:text-white hover:bg-white/10 px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider transition min-h-[44px] flex items-center gap-1.5"><Download size={13}/> PDF</button>}
                  <button onClick={fetchBalanceSheet} className="bg-brand text-white px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider hover:bg-brand/90 transition min-h-[44px] flex items-center gap-1.5"><RefreshCw size={13}/> Refresh</button>
                </div>
              </div>

              {!bsData ? (
                <div className="py-16 text-center text-white/30 font-bold uppercase tracking-widest text-sm">Click "Refresh" to load</div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Assets */}
                  <div>
                    <h4 className="text-brand font-black text-sm uppercase tracking-widest border-b border-white/10 pb-2 mb-3">Assets</h4>
                    <table className="w-full text-sm">
                      <tbody>
                        {bsData.assets.map(r => (
                          <tr key={r.code} className="border-b border-white/5">
                            <td className="py-2 text-white/60 text-xs"><span className="text-white/30 mr-2">{r.code}</span>{r.name}</td>
                            <td className="py-2 text-right text-white tabular-nums font-bold">₱{r.amount.toFixed(2)}</td>
                          </tr>
                        ))}
                        <tr><td className="pt-3 font-black text-white uppercase text-xs">Total Assets</td><td className="pt-3 text-right text-brand tabular-nums font-black text-lg">₱{bsData.totals.assets.toFixed(2)}</td></tr>
                      </tbody>
                    </table>
                  </div>
                  {/* Liabilities */}
                  <div>
                    <h4 className="text-red-400 font-black text-sm uppercase tracking-widest border-b border-white/10 pb-2 mb-3">Liabilities</h4>
                    <table className="w-full text-sm">
                      <tbody>
                        {bsData.liabilities.length === 0 ? <tr><td className="py-2 text-white/30 text-xs italic">No liabilities recorded</td></tr> :
                          bsData.liabilities.map(r => (
                          <tr key={r.code} className="border-b border-white/5">
                            <td className="py-2 text-white/60 text-xs"><span className="text-white/30 mr-2">{r.code}</span>{r.name}</td>
                            <td className="py-2 text-right text-white tabular-nums font-bold">₱{r.amount.toFixed(2)}</td>
                          </tr>
                        ))}
                        <tr><td className="pt-3 font-black text-white uppercase text-xs">Total Liabilities</td><td className="pt-3 text-right text-red-400 tabular-nums font-black">₱{bsData.totals.liabilities.toFixed(2)}</td></tr>
                      </tbody>
                    </table>
                  </div>
                  {/* Equity */}
                  <div>
                    <h4 className="text-green-400 font-black text-sm uppercase tracking-widest border-b border-white/10 pb-2 mb-3">Equity</h4>
                    <table className="w-full text-sm">
                      <tbody>
                        {bsData.equity.map(r => (
                          <tr key={r.code} className="border-b border-white/5">
                            <td className="py-2 text-white/60 text-xs"><span className="text-white/30 mr-2">{r.code}</span>{r.name}</td>
                            <td className="py-2 text-right text-white tabular-nums font-bold">{r.amount < 0 ? '−' : ''}₱{Math.abs(r.amount).toFixed(2)}</td>
                          </tr>
                        ))}
                        <tr><td className="pt-3 font-black text-white uppercase text-xs">Total Equity</td><td className="pt-3 text-right text-green-400 tabular-nums font-black">₱{bsData.totals.equity.toFixed(2)}</td></tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {bsData && (
                <div className={`mt-4 rounded-xl p-4 flex justify-between items-center border ${bsData.totals.balanced ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
                  <div>
                    <p className="text-white/60 text-xs font-black uppercase tracking-widest">Accounting Equation Check</p>
                    <p className="text-white/40 text-xs mt-1">Assets = Liabilities + Equity</p>
                  </div>
                  <div className="text-right">
                    <p className="text-white tabular-nums font-black text-lg">₱{bsData.totals.assets.toFixed(2)} = ₱{bsData.totals.liabilitiesAndEquity.toFixed(2)}</p>
                    <p className={`text-xs font-black uppercase mt-1 ${bsData.totals.balanced ? 'text-green-400' : 'text-red-400'}`}>{bsData.totals.balanced ? '✓ Balanced' : '✗ Out of Balance'}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ===== A/R OUTSTANDING SUB-TAB ===== */}
          {ledgerSubTab === 'ar' && (
            <div className="bg-surface border border-white/8 rounded-2xl p-6 space-y-4 animate-fade-in">
              <div className="flex justify-between items-end border-b border-white/10 pb-4">
                <div>
                  <h3 className="text-2xl font-black text-white">Accounts Receivable</h3>
                  <p className="text-white/40 text-xs font-bold uppercase tracking-widest mt-1">Non-Cash sales awaiting settlement (E-Wallet · Bank · Delivery)</p>
                </div>
                <div className="text-right">
                  <p className="text-white/40 text-[10px] font-bold uppercase">Total Outstanding</p>
                  <p className="text-3xl text-brand font-black tabular-nums">₱{arOutstanding.totalOutstanding.toFixed(2)}</p>
                </div>
              </div>

              {arOutstanding.orders.length === 0 ? (
                <div className="py-16 text-center text-white/30 font-bold uppercase tracking-widest text-sm">No outstanding A/R 🎉</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-white/40 text-xs uppercase tracking-widest border-b border-white/10">
                        <th className="text-left py-3">Order #</th>
                        <th className="text-left py-3">Customer</th>
                        <th className="text-left py-3">Channel</th>
                        <th className="text-left py-3">Date</th>
                        <th className="text-right py-3">Amount</th>
                        <th className="text-right py-3">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {arPage.pageItems.map(o => (
                        <tr key={o._id} className="border-b border-white/5 hover:bg-white/5 transition">
                          <td className="py-3 text-white font-bold">{o.orderNumber}</td>
                          <td className="py-3 text-white/70">{o.customerName}</td>
                          <td className="py-3"><span className="text-[10px] font-black uppercase tracking-wider bg-brand/20 text-brand px-2 py-1 rounded">{o.paymentMethod}</span></td>
                          <td className="py-3 text-white/50 text-xs">{new Date(o.createdAt).toLocaleDateString()}</td>
                          <td className="py-3 text-right text-white tabular-nums font-bold">₱{o.total.toFixed(2)}</td>
                          <td className="py-3 text-right">
                            <button onClick={() => {
                              // Smart-default deposit channel based on original payment method
                              let defaultMethod = 'Cash on Hand';
                              if (o.paymentMethod === 'Bank Transfer') defaultMethod = 'Bank Transfer';
                              else if (['GCash','Maya','Maribank','E-Wallet','Other E-Wallet'].includes(o.paymentMethod)) defaultMethod = o.paymentMethod === 'Other E-Wallet' ? 'GCash' : o.paymentMethod;
                              else if (['Grab Delivery','Foodpanda','Manual Delivery'].includes(o.paymentMethod)) defaultMethod = 'Bank Transfer';
                              setSettleModal({ order: o });
                              setSettleForm({ amount: o.total.toFixed(2), paymentMethod: defaultMethod, note: '' });
                            }}
                              className="bg-brand text-white px-3 py-2 rounded-lg font-bold text-[10px] uppercase tracking-wider hover:bg-brand/90 transition min-h-[40px]">
                              Settle
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <Pager {...arPage} label="orders" />
                </div>
              )}
            </div>
          )}

          {/* ===== ACCOUNTS PAYABLE SUB-TAB ===== */}
          {ledgerSubTab === 'ap' && (
            <div className="space-y-6 animate-fade-in">
              {/* Summary KPI bar */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-surface border border-white/8 rounded-xl p-5">
                  <p className="text-[10px] text-white/40 font-bold uppercase tracking-widest mb-1">Outstanding A/P Balance</p>
                  <p className={`text-2xl font-black tabular-nums ${apData?.outstandingBalance > 0 ? 'text-red-400' : 'text-green-400'}`}>
                    ₱{(apData?.outstandingBalance || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </p>
                  <p className="text-[10px] text-white/30 mt-1">Total owed to suppliers</p>
                </div>
                <div className="bg-surface border border-white/8 rounded-xl p-5">
                  <p className="text-[10px] text-white/40 font-bold uppercase tracking-widest mb-1">Total Purchased on Credit</p>
                  <p className="text-xl font-black text-white/80 tabular-nums">₱{(apData?.totalCredit || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                </div>
                <div className="bg-surface border border-white/8 rounded-xl p-5">
                  <p className="text-[10px] text-white/40 font-bold uppercase tracking-widest mb-1">Total Payments Made</p>
                  <p className="text-xl font-black text-green-400/80 tabular-nums">₱{(apData?.totalDebit || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
                </div>
              </div>

              {/* Pay AP button */}
              {apData?.outstandingBalance > 0 && (
                <div className="flex justify-end">
                  <button onClick={() => setApPayModal(true)}
                    className="flex items-center gap-2 px-5 py-2.5 bg-brand text-white rounded-xl font-bold text-sm hover:bg-brand/90 transition shadow-elev-1">
                    <CreditCard size={15}/> Record Supplier Payment
                  </button>
                </div>
              )}

              {/* Pay AP modal */}
              {apPayModal && (
                <div className="fixed inset-0 z-[9998] bg-black/85 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
                  <div className="bg-[#111] border border-white/10 rounded-2xl w-full max-w-sm shadow-elev-3 flex flex-col max-h-[90vh] overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
                      <h2 className="text-white font-black text-lg">Record A/P Payment</h2>
                      <button onClick={() => setApPayModal(false)} className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 text-white/50 flex items-center justify-center transition"><X size={14}/></button>
                    </div>
                    <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                      <div className="bg-brand/10 border border-brand/20 rounded-xl px-4 py-3 text-xs text-brand/80 font-bold">
                        Outstanding: ₱{(apData?.outstandingBalance || 0).toFixed(2)} · Journal: DR 2000 A/P / CR Cash
                      </div>
                      <div>
                        <label className="text-[10px] text-white/40 font-bold uppercase block mb-1">Amount (₱) *</label>
                        <input type="number" min="0" step="0.01" value={apPayForm.amount}
                          onChange={e => setApPayForm(p => ({...p, amount: e.target.value}))}
                          className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-3 text-white text-xl font-black tabular-nums outline-none focus:border-brand/60" />
                      </div>
                      <div>
                        <label className="text-[10px] text-white/40 font-bold uppercase block mb-1">Pay From *</label>
                        <select value={apPayForm.payFromAccount} onChange={e => setApPayForm(p => ({...p, payFromAccount: e.target.value}))}
                          className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-3 text-white font-bold outline-none focus:border-brand/60">
                          <option value="1000">Cash on Hand (1000)</option>
                          <option value="1010">Cash in Bank (1010)</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-white/40 font-bold uppercase block mb-1">Vendor / Supplier</label>
                        <input type="text" placeholder="e.g. Puregold, San Miguel" value={apPayForm.vendorName}
                          onChange={e => setApPayForm(p => ({...p, vendorName: e.target.value}))}
                          className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-3 text-white outline-none focus:border-brand/60 placeholder-white/20" />
                      </div>
                      <div>
                        <label className="text-[10px] text-white/40 font-bold uppercase block mb-1">Description</label>
                        <input type="text" placeholder="e.g. Weekly supply payment" value={apPayForm.description}
                          onChange={e => setApPayForm(p => ({...p, description: e.target.value}))}
                          className="w-full bg-page-bg border border-white/10 rounded-xl px-3 py-3 text-white outline-none focus:border-brand/60 placeholder-white/20" />
                      </div>
                    </div>
                    <div className="px-5 py-4 border-t border-white/8 flex gap-3">
                      <button onClick={() => setApPayModal(false)} className="flex-1 bg-white/5 text-white/60 rounded-xl py-3 font-bold text-sm hover:bg-white/10 transition">Cancel</button>
                      <button onClick={submitApPayment} disabled={apPaySubmitting}
                        className="flex-1 bg-brand text-white rounded-xl py-3 font-bold text-sm hover:bg-brand/90 transition disabled:opacity-50">
                        {apPaySubmitting ? 'Recording…' : 'Record Payment'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Recent AP Journal Entries */}
              <div className="bg-surface border border-white/8 rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-white/8 flex items-center gap-2">
                  <FileText size={14} className="text-white/50"/>
                  <h3 className="text-sm font-black text-white uppercase tracking-wider">A/P Journal History</h3>
                  <span className="ml-auto text-[10px] bg-white/8 text-white/40 px-2 py-0.5 rounded-full font-bold">{(apData?.recent || []).length} entries</span>
                </div>
                {!apData ? (
                  <p className="text-white/30 text-sm p-6 text-center font-bold">Loading…</p>
                ) : (apData.recent || []).length === 0 ? (
                  <p className="text-white/30 text-sm p-6 text-center font-bold">No A/P transactions yet. Procure inventory on credit to see entries here.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs min-w-[480px]">
                      <thead className="text-white/25 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
                        <tr>
                          <th className="px-5 py-2.5">Date</th>
                          <th className="px-5 py-2.5">Reference</th>
                          <th className="px-5 py-2.5">Description</th>
                          <th className="px-5 py-2.5 text-right">Incurred (CR)</th>
                          <th className="px-5 py-2.5 text-right">Paid (DR)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {apPage.pageItems.map((e, i) => (
                          <tr key={e._id || i} className={`border-b border-white/5 hover:bg-white/3 ${i % 2 === 0 ? '' : 'bg-white/[0.015]'}`}>
                            <td className="px-5 py-2.5 text-white/40 whitespace-nowrap">{new Date(e.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: '2-digit' })}</td>
                            <td className="px-5 py-2.5 font-mono text-white/60 whitespace-nowrap">{e.reference}</td>
                            <td className="px-5 py-2.5 text-white/70 truncate max-w-[200px]">{e.description}</td>
                            <td className="px-5 py-2.5 text-right text-red-400 font-mono tabular-nums font-bold">{e.credit > 0 ? `₱${e.credit.toFixed(2)}` : '—'}</td>
                            <td className="px-5 py-2.5 text-right text-green-400 font-mono tabular-nums font-bold">{e.debit > 0 ? `₱${e.debit.toFixed(2)}` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <Pager {...apPage} label="entries" />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ===== SALES BY PAYMENT METHOD ===== */}
          {ledgerSubTab === 'payments' && (
            <div className="space-y-4 animate-fade-in">
              {/* Date range picker */}
              <div className="flex flex-wrap gap-3 items-center">
                <input type="date" value={sbpRange.start} onChange={e => setSbpRange(p=>({...p,start:e.target.value}))}
                  className="bg-surface border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-brand/50" />
                <span className="text-white/30 font-bold text-sm">→</span>
                <input type="date" value={sbpRange.end} onChange={e => setSbpRange(p=>({...p,end:e.target.value}))}
                  className="bg-surface border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-brand/50" />
                <button onClick={fetchSalesByPayment} className="px-5 py-2 bg-brand text-white rounded-xl font-bold text-sm hover:bg-brand/90 transition">Load</button>
              </div>
              {!salesByPayment ? (
                <p className="text-white/30 text-sm text-center p-6 font-bold">Select a date range and click Load.</p>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="bg-surface border border-white/8 rounded-xl p-5">
                      <p className="text-[10px] text-white/40 font-bold uppercase">Total Revenue</p>
                      <p className="text-2xl font-black text-brand tabular-nums">₱{(salesByPayment.grandTotal||0).toLocaleString('en-PH',{minimumFractionDigits:2})}</p>
                    </div>
                    <div className="bg-surface border border-white/8 rounded-xl p-5">
                      <p className="text-[10px] text-white/40 font-bold uppercase">Payment Channels</p>
                      <p className="text-2xl font-black text-white">{(salesByPayment.breakdown||[]).length}</p>
                    </div>
                  </div>
                  <div className="bg-surface border border-white/8 rounded-xl overflow-hidden">
                    <table className="w-full text-left text-xs min-w-[400px]">
                      <thead className="text-white/25 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
                        <tr>
                          <th className="px-5 py-3">Payment Method</th>
                          <th className="px-5 py-3 text-right">Orders</th>
                          <th className="px-5 py-3 text-right">Amount</th>
                          <th className="px-5 py-3 text-right">% Share</th>
                          <th className="px-5 py-3">Bar</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sbpPage.pageItems.map((r,i) => (
                          <tr key={r.method||i} className={`border-b border-white/5 ${i%2===0?'':'bg-white/[0.015]'}`}>
                            <td className="px-5 py-3 font-bold text-white">{r.method||'Unknown'}</td>
                            <td className="px-5 py-3 text-right text-white/70 tabular-nums">{r.count}</td>
                            <td className="px-5 py-3 text-right font-black text-brand tabular-nums">₱{(r.total||0).toFixed(2)}</td>
                            <td className="px-5 py-3 text-right text-white/50 tabular-nums">{(r.pct||0).toFixed(1)}%</td>
                            <td className="px-5 py-3 w-32">
                              <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                                <div className="h-full bg-brand rounded-full" style={{width:`${Math.min(100,r.pct||0)}%`}} />
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <Pager {...sbpPage} label="methods" />
                  </div>
                </>
              )}
            </div>
          )}

          {/* ===== PROFIT BY CATEGORY ===== */}
          {ledgerSubTab === 'profitcat' && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex justify-end">
                <button onClick={fetchProfitByCategory} className="flex items-center gap-2 px-5 py-2.5 bg-brand text-white rounded-xl font-bold text-sm hover:bg-brand/90 transition">
                  <RefreshCw size={14}/> Refresh
                </button>
              </div>
              {!profitByCategory ? (
                <p className="text-white/30 text-sm text-center p-6 font-bold">Click Refresh to compute gross profit by menu category.</p>
              ) : (
                <div className="bg-surface border border-white/8 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs min-w-[500px]">
                    <thead className="text-white/25 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
                      <tr>
                        <th className="px-5 py-3">Category</th>
                        <th className="px-5 py-3 text-right">Revenue</th>
                        <th className="px-5 py-3 text-right">Est. COGS</th>
                        <th className="px-5 py-3 text-right">Gross Profit</th>
                        <th className="px-5 py-3 text-right">Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pbcPage.pageItems.map((c,i) => (
                        <tr key={c.category||i} className={`border-b border-white/5 ${i%2===0?'':'bg-white/[0.015]'}`}>
                          <td className="px-5 py-3 font-bold text-white">{c.category}</td>
                          <td className="px-5 py-3 text-right text-white/80 tabular-nums font-mono">₱{c.revenue.toFixed(2)}</td>
                          <td className="px-5 py-3 text-right text-orange-400/70 tabular-nums font-mono">₱{c.estimatedCOGS.toFixed(2)}</td>
                          <td className="px-5 py-3 text-right font-black tabular-nums font-mono text-green-400">₱{c.grossProfit.toFixed(2)}</td>
                          <td className="px-5 py-3 text-right">
                            <span className={`font-black text-sm ${c.margin>=60?'text-green-400':c.margin>=35?'text-yellow-400':'text-red-400'}`}>
                              {c.margin.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="px-3"><Pager {...pbcPage} label="categories" /></div>
                  <p className="text-[10px] text-white/20 p-3 text-center">COGS is estimated from recipe ingredient costs. Items without recipes show ₱0 COGS.</p>
                </div>
              )}
            </div>
          )}

          {/* ===== MENU ENGINEERING ===== */}
          {ledgerSubTab === 'menueng' && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex justify-between items-center">
                <p className="text-xs text-white/40">Stars (sell + profit), Plowhorses (sell, low margin), Puzzles (high margin, low sell), Dogs (neither).</p>
                <button onClick={fetchMenuEngineering} className="flex items-center gap-2 px-4 py-2 bg-brand text-white rounded-xl font-bold text-sm hover:bg-brand/90 transition"><RefreshCw size={14}/> Refresh</button>
              </div>
              {!menuEngineering ? (
                <p className="text-white/30 text-sm text-center p-6 font-bold">Click Refresh to analyse the menu.</p>
              ) : (
                <div className="bg-surface border border-white/8 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs min-w-[520px]">
                    <thead className="text-white/25 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
                      <tr><th className="px-5 py-3">Item</th><th className="px-5 py-3 text-right">Qty</th><th className="px-5 py-3 text-right">Revenue</th><th className="px-5 py-3 text-right">Margin</th><th className="px-5 py-3 text-center">Class</th></tr>
                    </thead>
                    <tbody>
                      {mePage.pageItems.map((r,i) => {
                        const cls = { Star:'bg-green-500/20 text-green-400', Plowhorse:'bg-yellow-500/20 text-yellow-400', Puzzle:'bg-blue-500/20 text-blue-400', Dog:'bg-red-500/20 text-red-400' }[r.quadrant];
                        return (
                          <tr key={i} className={`border-b border-white/5 ${i%2?'bg-white/[0.015]':''}`}>
                            <td className="px-5 py-2.5 font-bold text-white">{r.name}</td>
                            <td className="px-5 py-2.5 text-right text-white/70 tabular-nums">{r.qty}</td>
                            <td className="px-5 py-2.5 text-right text-brand font-black tabular-nums">₱{r.revenue.toFixed(2)}</td>
                            <td className="px-5 py-2.5 text-right tabular-nums font-bold text-white/70">{r.margin.toFixed(1)}%</td>
                            <td className="px-5 py-2.5 text-center"><span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${cls}`}>{r.quadrant}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="px-3"><Pager {...mePage} label="items" /></div>
                </div>
              )}
            </div>
          )}

          {/* ===== CASHIER VARIANCE ===== */}
          {ledgerSubTab === 'variance' && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex justify-between items-center">
                <p className="text-xs text-white/40">Average cash drawer variance per cashier across closed shifts. Negative = consistently short.</p>
                <button onClick={fetchCashierVariance} className="flex items-center gap-2 px-4 py-2 bg-brand text-white rounded-xl font-bold text-sm hover:bg-brand/90 transition"><RefreshCw size={14}/> Refresh</button>
              </div>
              {!cashierVariance ? (
                <p className="text-white/30 text-sm text-center p-6 font-bold">Click Refresh to load cashier variance.</p>
              ) : (cashierVariance.cashiers||[]).length === 0 ? (
                <p className="text-white/30 text-sm text-center p-6 font-bold">No closed shifts with variance data yet.</p>
              ) : (
                <div className="bg-surface border border-white/8 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs min-w-[480px]">
                    <thead className="text-white/25 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
                      <tr><th className="px-5 py-3">Cashier</th><th className="px-5 py-3 text-right">Shifts</th><th className="px-5 py-3 text-right">Avg Variance</th><th className="px-5 py-3 text-right">Times Short</th><th className="px-5 py-3 text-right">Worst</th></tr>
                    </thead>
                    <tbody>
                      {cvPage.pageItems.map((c,i) => (
                        <tr key={i} className={`border-b border-white/5 ${i%2?'bg-white/[0.015]':''}`}>
                          <td className="px-5 py-2.5 font-bold text-white">{c.cashierName}</td>
                          <td className="px-5 py-2.5 text-right text-white/70 tabular-nums">{c.shifts}</td>
                          <td className={`px-5 py-2.5 text-right tabular-nums font-black ${c.avgVariance < 0 ? 'text-red-400' : 'text-green-400'}`}>{c.avgVariance >= 0 ? '+' : ''}₱{c.avgVariance.toFixed(2)}</td>
                          <td className="px-5 py-2.5 text-right text-white/70 tabular-nums">{c.shortCount}</td>
                          <td className="px-5 py-2.5 text-right text-red-400 tabular-nums">₱{(c.worstShort||0).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="px-3"><Pager {...cvPage} label="cashiers" /></div>
                </div>
              )}
            </div>
          )}

          {/* ===== PURCHASE ORDER SUGGESTION ===== */}
          {ledgerSubTab === 'po' && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex justify-between items-center flex-wrap gap-2">
                <p className="text-xs text-white/40">Suggested reorder quantities to cover ~7 days, based on 30-day usage + low-stock flags.</p>
                <div className="flex gap-2">
                  {purchaseOrder && (purchaseOrder.lines||[]).length > 0 && <button onClick={exportPurchaseOrderPDF} className="flex items-center gap-2 px-4 py-2 bg-white/5 text-white/60 rounded-xl font-bold text-sm hover:bg-white/10 transition"><Download size={14}/> PDF</button>}
                  <button onClick={fetchPurchaseOrder} className="flex items-center gap-2 px-4 py-2 bg-brand text-white rounded-xl font-bold text-sm hover:bg-brand/90 transition"><RefreshCw size={14}/> Generate</button>
                </div>
              </div>
              {!purchaseOrder ? (
                <p className="text-white/30 text-sm text-center p-6 font-bold">Click Generate to build a purchase order.</p>
              ) : (purchaseOrder.lines||[]).length === 0 ? (
                <p className="text-green-400/70 text-sm text-center p-6 font-bold">✓ Stock levels are healthy — nothing to reorder.</p>
              ) : (
                <div className="bg-surface border border-white/8 rounded-xl overflow-hidden">
                  <div className="px-5 py-3 border-b border-white/8 flex justify-between items-center">
                    <h3 className="text-sm font-black text-white uppercase tracking-wider">Suggested Purchase Order</h3>
                    <span className="text-sm font-black text-brand tabular-nums">Est. ₱{(purchaseOrder.totalEstCost||0).toFixed(2)}</span>
                  </div>
                  <table className="w-full text-left text-xs min-w-[520px]">
                    <thead className="text-white/25 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
                      <tr><th className="px-5 py-3">Item</th><th className="px-5 py-3 text-right">On Hand</th><th className="px-5 py-3 text-right">Daily Use</th><th className="px-5 py-3 text-right">Order Qty</th><th className="px-5 py-3 text-right">Est. Cost</th></tr>
                    </thead>
                    <tbody>
                      {poPage.pageItems.map((l,i) => (
                        <tr key={i} className={`border-b border-white/5 ${i%2?'bg-white/[0.015]':''}`}>
                          <td className="px-5 py-2.5 font-bold text-white">{l.itemName} {l.lowStock && <span className="text-[9px] bg-red-500 text-white px-1.5 py-0.5 rounded uppercase ml-1">Low</span>}</td>
                          <td className="px-5 py-2.5 text-right text-white/70 tabular-nums">{l.currentStock} {l.displayUnit}</td>
                          <td className="px-5 py-2.5 text-right text-white/50 tabular-nums">{l.avgDailyUse} {l.displayUnit}</td>
                          <td className="px-5 py-2.5 text-right text-brand font-black tabular-nums">{l.suggestedOrder} {l.displayUnit}</td>
                          <td className="px-5 py-2.5 text-right text-white/70 tabular-nums">₱{l.estCost.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="px-3"><Pager {...poPage} label="items" /></div>
                </div>
              )}
            </div>
          )}

          {/* ===== REVOLVING FUNDS SUB-TAB ===== */}
          {ledgerSubTab === 'revolving' && (
            <div className="space-y-6 animate-fade-in">

              {/* HEADER + NEW FUND BUTTON */}
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 border-b border-white/10 pb-4">
                <div>
                  <h3 className="text-2xl font-black text-white">Revolving Funds</h3>
                  <p className="text-white/40 text-xs font-bold uppercase tracking-widest mt-1">Petty cash pools — track disbursements and replenishments</p>
                </div>
                <button
                  onClick={() => setRfNewModal(true)}
                  className="flex items-center gap-2 bg-brand text-white px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-brand/90 transition min-h-[44px] shrink-0"
                >
                  <Plus size={14}/> New Fund
                </button>
              </div>

              {rfLoading && <div className="py-12 text-center text-white/30 font-bold uppercase text-sm tracking-widest">Loading…</div>}

              {!rfLoading && rfFunds.length === 0 && (
                <div className="py-16 text-center space-y-3">
                  <RefreshCw size={32} className="mx-auto text-white/20"/>
                  <p className="text-white/30 font-bold uppercase tracking-widest text-sm">No revolving funds yet</p>
                  <p className="text-white/20 text-xs">Create a fund to track petty cash and small operational expenses.</p>
                </div>
              )}

              {!rfLoading && rfFunds.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                  {rfFunds.map(fund => {
                    const pct      = fund.initialAmount > 0 ? (fund.currentBalance / fund.initialAmount) * 100 : 0;
                    const low      = pct <= 25;
                    const isActive = rfActiveFund?._id === fund._id;
                    return (
                      <div key={fund._id}
                        className={`bg-surface border rounded-2xl p-5 space-y-4 transition ${isActive ? 'border-brand shadow-lg shadow-brand/10' : 'border-white/8'}`}
                      >
                        {/* Fund name + close button */}
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-white font-black text-base leading-tight">{fund.name}</p>
                            {fund.description && <p className="text-white/40 text-xs mt-0.5 line-clamp-1">{fund.description}</p>}
                          </div>
                          <button
                            onClick={() => closeRfFund(fund._id)}
                            className="text-white/20 hover:text-danger transition p-1 shrink-0"
                            title="Close fund"
                          ><X size={13}/></button>
                        </div>

                        {/* Balance display */}
                        <div>
                          <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-0.5">Current Balance</p>
                          <p className={`text-3xl font-black tabular-nums ${low ? 'text-danger' : 'text-brand'}`}>
                            ₱{fund.currentBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </p>
                          <p className="text-white/30 text-xs">of ₱{fund.initialAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })} initial</p>
                        </div>

                        {/* Progress bar */}
                        <div className="space-y-1">
                          <div className="w-full bg-white/10 rounded-full h-1.5">
                            <div
                              className={`h-1.5 rounded-full transition-all ${low ? 'bg-danger' : 'bg-brand'}`}
                              style={{ width: `${Math.min(100, pct).toFixed(1)}%` }}
                            />
                          </div>
                          <p className={`text-[10px] font-bold ${low ? 'text-danger' : 'text-white/30'}`}>
                            {pct.toFixed(0)}% remaining{low ? ' — LOW' : ''}
                          </p>
                        </div>

                        {/* Action buttons */}
                        <div className="grid grid-cols-3 gap-1.5 pt-1">
                          <button
                            onClick={() => { setRfActiveFund(fund); setRfDisbForm({ amount: '', description: '', categoryCode: '6090' }); setRfDisbModal(true); }}
                            className="bg-danger/10 text-danger border border-danger/20 rounded-xl py-2 font-bold text-[10px] uppercase tracking-wider hover:bg-danger/20 transition min-h-[40px]"
                          >
                            <Minus size={11} className="inline mr-1"/>Out
                          </button>
                          <button
                            onClick={() => { setRfActiveFund(fund); setRfReplForm({ amount: (fund.initialAmount - fund.currentBalance).toFixed(2), note: '', sourceAccount: '1000' }); setRfReplModal(true); }}
                            className="bg-brand/10 text-brand border border-brand/20 rounded-xl py-2 font-bold text-[10px] uppercase tracking-wider hover:bg-brand/20 transition min-h-[40px]"
                          >
                            <Plus size={11} className="inline mr-1"/>In
                          </button>
                          <button
                            onClick={() => {
                              if (isActive) {
                                // clicking again collapses the history
                                setRfActiveFund(null);
                                setRfTxs([]);
                              } else {
                                setRfActiveFund(fund);
                                setRfTxs([]);
                                fetchRfTxs(fund._id, 1);
                              }
                            }}
                            className={`rounded-xl py-2 font-bold text-[10px] uppercase tracking-wider transition min-h-[40px] border ${isActive ? 'bg-white/10 text-white border-white/20' : 'bg-white/5 text-white/40 border-white/10 hover:bg-white/10 hover:text-white'}`}
                          >
                            <FileText size={11} className="inline mr-1"/>{isActive ? 'Hide' : 'History'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* TRANSACTION HISTORY — only shown when a fund is explicitly selected */}
              {rfActiveFund && (
                <div className="bg-surface border border-brand/30 rounded-2xl overflow-hidden animate-fade-in">
                  {/* Header */}
                  <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-brand/5">
                    <div>
                      <h4 className="text-white font-black text-lg">Transaction History</h4>
                      <p className="text-brand text-xs font-bold uppercase tracking-widest mt-0.5">{rfActiveFund.name}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-white/30 text-xs tabular-nums">{rfTxTotal} {rfTxTotal === 1 ? 'entry' : 'entries'}</span>
                      <button
                        onClick={() => { setRfActiveFund(null); setRfTxs([]); }}
                        className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/15 text-white/40 hover:text-white flex items-center justify-center transition"
                        title="Close history"
                      ><X size={14}/></button>
                    </div>
                  </div>

                  {/* Table */}
                  {rfTxs.length === 0 ? (
                    <div className="py-14 text-center">
                      <FileText size={28} className="mx-auto text-white/15 mb-3"/>
                      <p className="text-white/30 text-sm font-bold uppercase tracking-widest">No transactions yet</p>
                      <p className="text-white/20 text-xs mt-1">Disbursements and replenishments will appear here.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-white/40 text-[10px] font-bold uppercase tracking-widest border-b border-white/10 bg-white/2">
                            <th className="text-left px-6 py-3">Date</th>
                            <th className="text-left px-3 py-3">Type</th>
                            <th className="text-left px-3 py-3">Description</th>
                            <th className="text-left px-3 py-3 hidden sm:table-cell">By</th>
                            <th className="text-right px-3 py-3">Amount</th>
                            <th className="text-right px-6 py-3">Balance After</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rfTxs.map((tx, idx) => (
                            <tr key={tx._id} className={`border-b border-white/5 transition hover:bg-white/3 ${idx % 2 === 0 ? '' : 'bg-white/1'}`}>
                              <td className="py-3 px-6 text-white/50 text-xs tabular-nums whitespace-nowrap">
                                {new Date(tx.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                              </td>
                              <td className="py-3 px-3">
                                <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-full whitespace-nowrap ${tx.type === 'disbursement' ? 'bg-danger/20 text-danger' : 'bg-brand/20 text-brand'}`}>
                                  {tx.type === 'disbursement' ? '▼ Out' : '▲ In'}
                                </span>
                              </td>
                              <td className="py-3 px-3 text-white/80 max-w-[200px] truncate">{tx.description}</td>
                              <td className="py-3 px-3 text-white/40 text-xs hidden sm:table-cell">{tx.performedBy || '—'}</td>
                              <td className={`py-3 px-3 text-right font-black tabular-nums ${tx.type === 'disbursement' ? 'text-danger' : 'text-brand'}`}>
                                {tx.type === 'disbursement' ? '−' : '+'}₱{tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </td>
                              <td className="py-3 px-6 text-right text-white/50 tabular-nums text-xs">
                                ₱{(tx.balanceAfter ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Pagination — always visible when there are entries */}
                  {rfTxTotal > 0 && (
                    <div className="flex items-center justify-between px-6 py-3 border-t border-white/8 bg-white/1">
                      <button
                        disabled={rfTxPage <= 1}
                        onClick={() => fetchRfTxs(rfActiveFund._id, rfTxPage - 1)}
                        className="px-4 py-2 rounded-lg bg-white/5 text-white/50 font-bold text-xs disabled:opacity-25 hover:bg-white/10 hover:text-white transition"
                      >← Prev</button>
                      <span className="text-white/30 text-xs font-bold">
                        Page {rfTxPage} of {rfTxPages} &nbsp;·&nbsp; {rfTxTotal} {rfTxTotal === 1 ? 'entry' : 'entries'}
                      </span>
                      <button
                        disabled={rfTxPage >= rfTxPages}
                        onClick={() => fetchRfTxs(rfActiveFund._id, rfTxPage + 1)}
                        className="px-4 py-2 rounded-lg bg-white/5 text-white/50 font-bold text-xs disabled:opacity-25 hover:bg-white/10 hover:text-white transition"
                      >Next →</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

        </div>
  );
}
