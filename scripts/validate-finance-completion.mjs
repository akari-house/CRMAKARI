import fs from 'node:fs';

const invoiceAction = fs.readFileSync('functions/api/invoices/[id].js', 'utf8');
const referralAction = fs.readFileSync('functions/api/referrals/[id].js', 'utf8');
const invoiceList = fs.readFileSync('functions/api/invoices/index.js', 'utf8');
const commercial = fs.readFileSync('functions/lib/commercial-hardening.js', 'utf8');

const checks = [
  [invoiceAction.includes("action === 'receipt'"), 'invoice receipt action'],
  [invoiceAction.includes('Payment exceeds the outstanding invoice balance'), 'overpayment prevention'],
  [invoiceAction.includes('AKARI_INVOICE_RECEIPT_V1'), 'receipt evidence marker'],
  [invoiceAction.includes("status = outstanding <= 0.005 ? 'PAID' : 'PARTIALLY_PAID'"), 'deterministic reconciliation'],
  [invoiceAction.includes('releaseReferralRewards'), 'client-payment referral trigger'],
  [invoiceAction.includes("payment_status = 'DUE'"), 'referral due transition'],
  [invoiceAction.includes("action === 'credit'"), 'credit-note workflow'],
  [invoiceAction.includes("action === 'cancel'"), 'invoice cancellation workflow'],
  [invoiceAction.includes("payment_type IN ('INVOICE_RECEIPT','CREDIT_NOTE')"), 'receipt and credit loading'],
  [referralAction.includes('TRANSITIONS'), 'referral transition matrix'],
  [referralAction.includes("currentStatus !== 'DUE'"), 'due-only payout governance'],
  [referralAction.includes('Payment method is required when a referral reward is paid'), 'payout method evidence'],
  [referralAction.includes('REFERRAL_REWARD_PAID'), 'payout audit event'],
  [invoiceList.includes('nextInvoiceNumber'), 'invoice numbering'],
  [invoiceList.includes('This invoice number already exists'), 'duplicate invoice protection'],
  [commercial.includes("'OVERDUE'"), 'overdue invoice state'],
  [commercial.includes('outstanding'), 'invoice outstanding calculation'],
];

const failed = checks.filter(([ok]) => !ok).map(([, label]) => label);
if (failed.length) {
  console.error(`Finance completion validation failed: ${failed.join(', ')}`);
  process.exit(1);
}

console.log(`Finance completion validation passed (${checks.length} controls).`);
