export type LoanAgreementData = {
  id: string;
  status: string;
  memberName: string;
  membershipNumber?: string;
  nationalId?: string;
  phone?: string;
  email?: string;
  loanType?: string;
  applicationDate?: string;
  principalAmount: number;
  interestRate: number;
  totalPayable?: number;
  repaymentPeriodMonths?: number;
  repaymentMethod?: string;
  incomeSource?: string;
  monthlyIncome?: number;
  guarantorDetails?: string;
  collateralDetails?: string;
  purposeNotes?: string;
  issueDate?: string;
  dueDate?: string;
  approvedAt?: string;
  disbursedAt?: string;
  memberSavings?: number;
  membershipDays?: number;
  secretaryName?: string;
  secretaryReviewedAt?: string;
  secretaryNotes?: string;
  treasurerName?: string;
  treasurerReviewedAt?: string;
  treasurerNotes?: string;
  chairmanName?: string;
};

const PRINTABLE_STATUSES = new Set([
  "Approved",
  "Active",
  "Cleared",
  "Defaulted",
]);

export function isLoanAgreementAvailable(status: string): boolean {
  return PRINTABLE_STATUSES.has(status);
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function text(value: unknown, fallback = "Not recorded"): string {
  const normalized = String(value ?? "").trim();
  return escapeHtml(normalized || fallback);
}

function multiline(value: unknown, fallback = "Not recorded"): string {
  return text(value, fallback).replace(/\r?\n/g, "<br>");
}

function kes(value: number | undefined): string {
  return `KES ${Number(value || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function date(value: string | undefined, fallback = "Not recorded"): string {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? escapeHtml(value.slice(0, 10))
    : parsed.toLocaleDateString("en-KE", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      });
}

function dateTime(value: string | undefined): string {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? escapeHtml(value)
    : parsed.toLocaleString("en-KE", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function reference(data: LoanAgreementData): string {
  return `SOW-LOAN-${String(data.id)
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 10)
    .toUpperCase()}`;
}

function signatureBlock(title: string, name = ""): string {
  return `<div class="signature">
    <strong>${escapeHtml(title)}</strong>
    <div class="signature-name">${text(name, "Name: __________________________________")}</div>
    <div class="line">Signature: __________________________________</div>
    <div class="line">ID / Member No.: ___________________________</div>
    <div class="line">Date: ______________________________________</div>
  </div>`;
}

export function buildLoanAgreementHtml(
  data: LoanAgreementData,
  includePrintControl = false,
): string {
  const principal = Number(data.principalAmount || 0);
  const rate = Number(data.interestRate || 0);
  const financeCharge = (principal * rate) / 100;
  const totalPayable = Number(data.totalPayable ?? principal + financeCharge);
  const months = Number(data.repaymentPeriodMonths || 0);
  const estimatedInstallment = months > 0 ? totalPayable / months : 0;
  const approvedDate = data.approvedAt || data.issueDate;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${reference(data)} - Loan Agreement</title>
  <style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body { margin: 0 auto; max-width: 190mm; color: #172033; background: #fff; font: 10.5pt/1.45 Arial, sans-serif; }
    h1, h2, h3, p { margin-top: 0; }
    h1 { margin-bottom: 4px; color: #064e3b; font-size: 18pt; text-align: center; letter-spacing: .04em; }
    h2 { margin: 18px 0 8px; padding-bottom: 5px; border-bottom: 1.5px solid #047857; color: #064e3b; font-size: 12pt; }
    h3 { margin-bottom: 6px; font-size: 10.5pt; }
    .heading { border-bottom: 3px double #047857; padding-bottom: 12px; text-align: center; }
    .heading p { margin: 2px 0; }
    .reference { font-weight: 700; letter-spacing: .08em; }
    .notice { margin: 14px 0; border: 1px solid #f59e0b; background: #fffbeb; padding: 10px; font-size: 9pt; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px 18px; }
    .field { border-bottom: 1px dotted #94a3b8; padding: 4px 0; }
    .field span { display: block; color: #64748b; font-size: 8pt; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0; }
    th, td { border: 1px solid #cbd5e1; padding: 7px; text-align: left; vertical-align: top; }
    th { width: 34%; background: #ecfdf5; color: #064e3b; }
    .section, table, .signature { break-inside: avoid; page-break-inside: avoid; }
    .terms { margin: 8px 0 0; padding-left: 20px; }
    .terms li { margin: 5px 0; }
    .review { margin: 8px 0; border-left: 3px solid #10b981; background: #f8fafc; padding: 9px 11px; }
    .review p { margin: 3px 0; }
    .signatures { width: 100%; margin-top: 18px; border-collapse: separate; border-spacing: 9px 14px; }
    .signatures td { width: 50%; border: 0; padding: 0; vertical-align: top; }
    .signature-pair { break-inside: avoid; page-break-inside: avoid; }
    .signature { min-height: 128px; border: 1px solid #cbd5e1; padding: 12px; }
    .signature-name { margin-top: 14px; }
    .line { margin-top: 16px; }
    .footer { margin-top: 20px; border-top: 1px solid #94a3b8; padding-top: 8px; color: #64748b; font-size: 8pt; text-align: center; }
    .no-print { position: sticky; top: 8px; margin: 8px 0 16px; text-align: right; }
    .no-print button { border: 0; border-radius: 8px; background: #047857; color: white; padding: 10px 16px; font-weight: 700; cursor: pointer; }
    @media (max-width: 700px) {
      body { padding: 14px; font-size: 10pt; }
      .grid { grid-template-columns: 1fr; }
      .signatures, .signatures tbody, .signatures tr, .signatures td { display: block; width: 100%; }
      .signatures td { margin-bottom: 12px; }
      .signature { min-height: 130px; }
    }
    @media print {
      .no-print { display: none !important; }
      body { max-width: none; padding: 0; }
    }
  </style>
</head>
<body>
  ${includePrintControl ? '<div class="no-print"><button type="button" onclick="window.print()">Print / Save as PDF</button></div>' : ""}
  <header class="heading">
    <h1>SOWETAMU SACCO</h1>
    <p><strong>LOAN APPLICATION, APPROVAL AND AGREEMENT</strong></p>
    <p class="reference">Reference: ${reference(data)}</p>
    <p>Final approval date: ${date(approvedDate)} | Status: ${text(data.status)}</p>
  </header>

  <div class="notice">
    This computer-generated agreement is available only after final Chairman approval. It becomes an executed agreement when the required parties sign it. Before operational use, the SACCO should confirm that its registered by-laws and approved credit policy match these terms.
  </div>

  <section class="section">
    <h2>1. Parties and applicant identification</h2>
    <p><strong>Lender:</strong> Sowetamu SACCO (the "SACCO").</p>
    <p><strong>Borrower:</strong> The member identified below.</p>
    <div class="grid">
      <div class="field"><span>Full name</span>${text(data.memberName)}</div>
      <div class="field"><span>Membership number</span>${text(data.membershipNumber)}</div>
      <div class="field"><span>National ID</span>${text(data.nationalId)}</div>
      <div class="field"><span>Phone number</span>${text(data.phone)}</div>
      <div class="field"><span>Email</span>${text(data.email)}</div>
      <div class="field"><span>Membership duration at review</span>${data.membershipDays == null ? "Not recorded" : `${Number(data.membershipDays)} days`}</div>
    </div>
  </section>

  <section class="section">
    <h2>2. Application and affordability information</h2>
    <table>
      <tr><th>Loan type</th><td>${text(data.loanType, "General")}</td></tr>
      <tr><th>Application date</th><td>${date(data.applicationDate)}</td></tr>
      <tr><th>Purpose / application notes</th><td>${multiline(data.purposeNotes)}</td></tr>
      <tr><th>Income / business source</th><td>${multiline(data.incomeSource)}</td></tr>
      <tr><th>Estimated monthly income</th><td>${data.monthlyIncome == null ? "Not recorded" : kes(data.monthlyIncome)}</td></tr>
      <tr><th>Member savings at review</th><td>${data.memberSavings == null ? "Not recorded" : kes(data.memberSavings)}</td></tr>
      <tr><th>Proposed guarantor details</th><td>${multiline(data.guarantorDetails, "None recorded. A listed guarantor is not bound unless they sign the guarantor section below.")}</td></tr>
      <tr><th>Security / collateral</th><td>${multiline(data.collateralDetails, "None recorded")}</td></tr>
    </table>
  </section>

  <section class="section">
    <h2>3. Approved loan and lending disclosures</h2>
    <table>
      <tr><th>Amount financed / principal</th><td>${kes(principal)}</td></tr>
      <tr><th>Finance charge</th><td>${kes(financeCharge)}</td></tr>
      <tr><th>Interest rate</th><td>${rate.toFixed(3)}%</td></tr>
      <tr><th>Interest computation</th><td>Flat interest calculated once on the original principal for the agreed loan term: principal x ${rate.toFixed(3)}%.</td></tr>
      <tr><th>Interest begins</th><td>${date(data.issueDate, "On disbursement")}</td></tr>
      <tr><th>Total amount payable</th><td><strong>${kes(totalPayable)}</strong></td></tr>
      <tr><th>Repayment period</th><td>${months ? `${months} month${months === 1 ? "" : "s"}` : "Not recorded"}</td></tr>
      <tr><th>Indicative periodic instalment</th><td>${months ? `${kes(estimatedInstallment)} per month (subject to the SACCO collection schedule and final settlement figure)` : "Not calculated"}</td></tr>
      <tr><th>Repayment method</th><td>${text(data.repaymentMethod)}</td></tr>
      <tr><th>Disbursement / issue date</th><td>${date(data.disbursedAt || data.issueDate)}</td></tr>
      <tr><th>Final due date</th><td>${date(data.dueDate)}</td></tr>
      <tr><th>Other fees or late charges</th><td>No additional fee or late charge is recorded in this agreement. Any lawful additional charge must be disclosed to the borrower in writing and applied under the SACCO by-laws, credit policy and applicable law.</td></tr>
      <tr><th>Refinancing</th><td>Not automatic. Any refinancing or restructuring requires a separate written application and approval under the SACCO policy then in force.</td></tr>
      <tr><th>Statements</th><td>Continuous transaction access through the member portal, with a formal loan statement available on request and at least once every six months while the facility remains outstanding.</td></tr>
    </table>
  </section>

  <section class="section">
    <h2>4. Review and approval record</h2>
    <div class="review">
      <p><strong>Secretary eligibility review:</strong> ${text(data.secretaryName, "Recorded Secretary")}</p>
      <p><strong>Reviewed:</strong> ${dateTime(data.secretaryReviewedAt)}</p>
      <p><strong>Notes:</strong> ${multiline(data.secretaryNotes)}</p>
    </div>
    <div class="review">
      <p><strong>Treasurer financial review:</strong> ${text(data.treasurerName, "Recorded Treasurer")}</p>
      <p><strong>Reviewed:</strong> ${dateTime(data.treasurerReviewedAt)}</p>
      <p><strong>Notes:</strong> ${multiline(data.treasurerNotes)}</p>
    </div>
    <div class="review">
      <p><strong>Chairman final approval:</strong> ${text(data.chairmanName, "Recorded Chairman")}</p>
      <p><strong>Approved:</strong> ${dateTime(data.approvedAt)}</p>
    </div>
  </section>

  <section class="section">
    <h2>5. Borrower declarations and agreement terms</h2>
    <ol class="terms">
      <li>The Borrower confirms that the application and identification details above are complete and accurate to the best of their knowledge.</li>
      <li>The Borrower accepts the principal, disclosed finance charge, repayment method, loan term and due date and undertakes to repay the total amount payable.</li>
      <li>Failure to pay as agreed constitutes default. Notice, recovery, set-off, enforcement of security and any lawful charges shall follow the SACCO's registered by-laws, approved credit policy and applicable Kenyan law; this document does not create powers beyond them.</li>
      <li>Any guarantor must be informed of the nature and extent of the liability and must sign below before guarantor liability is created. Listing a proposed guarantor in the application is not a signature.</li>
      <li>Any collateral is subject to verification, valuation, charging, insurance or registration where required before it may be relied upon as security.</li>
      <li>The Borrower acknowledges processing of the information in this agreement for loan assessment, administration, reporting and lawful recovery, subject to the SACCO privacy notice and applicable data-protection law.</li>
      <li>No amendment, waiver, refinancing or restructuring is effective unless recorded in writing and approved by an authorized SACCO officer.</li>
      <li>This agreement is governed by Kenyan law, the Co-operative Societies framework, the Sacco Societies framework where applicable, and the SACCO's registered by-laws and approved credit policy.</li>
    </ol>
  </section>

  <section class="section">
    <h2>6. Manual signatures</h2>
    <table class="signatures">
      <tr class="signature-pair">
        <td>${signatureBlock("Borrower", data.memberName)}</td>
        <td>${signatureBlock("Witness")}</td>
      </tr>
      <tr class="signature-pair">
        <td>${signatureBlock("Chairman / Authorized Approver", data.chairmanName)}</td>
        <td>${signatureBlock("Secretary", data.secretaryName)}</td>
      </tr>
      <tr class="signature-pair">
        <td>${signatureBlock("Treasurer / Credit Officer", data.treasurerName)}</td>
        <td>${signatureBlock("Guarantor 1")}</td>
      </tr>
      <tr class="signature-pair">
        <td>${signatureBlock("Guarantor 2")}</td>
        <td>${signatureBlock("SACCO Stamp")}</td>
      </tr>
    </table>
  </section>

  <footer class="footer">
    Generated from the approved Sowetamu SACCO loan record. Reference ${reference(data)}. Verify all entries before signing; blank or "Not recorded" fields should be completed or formally marked not applicable.
  </footer>
</body>
</html>`;
}

export function printLoanAgreement(data: LoanAgreementData): boolean {
  const printWindow = window.open("", "_blank", "width=900,height=700");
  if (!printWindow) return false;
  printWindow.document.open();
  printWindow.document.write(buildLoanAgreementHtml(data, true));
  printWindow.document.close();
  printWindow.focus();
  window.setTimeout(() => printWindow.print(), 350);
  return true;
}

export function downloadLoanAgreementWord(data: LoanAgreementData): void {
  const blob = new Blob(["\ufeff", buildLoanAgreementHtml(data)], {
    type: "application/msword;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${reference(data)}-agreement.doc`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
