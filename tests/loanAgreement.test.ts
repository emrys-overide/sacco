import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLoanAgreementHtml, isLoanAgreementAvailable } from '../src/lib/loanAgreement';

test('builds a complete approved-loan agreement without trusting application HTML', () => {
  const html = buildLoanAgreementHtml({
    id: '12345678-abcd-4567-8901-123456789012',
    status: 'Active',
    memberName: 'Jane <script>alert(1)</script> Doe',
    membershipNumber: 'SWM-001',
    nationalId: '12345678',
    phone: '0712345678',
    email: 'jane@example.test',
    loanType: 'Business',
    applicationDate: '2026-07-01',
    principalAmount: 100_000,
    interestRate: 12,
    repaymentPeriodMonths: 12,
    repaymentMethod: 'SACCO collection',
    incomeSource: 'Matatu operations',
    monthlyIncome: 45_000,
    guarantorDetails: 'Member SWM-002',
    collateralDetails: 'Vehicle logbook submitted for verification',
    purposeNotes: 'Working capital',
    issueDate: '2026-07-10',
    dueDate: '2027-07-10',
    approvedAt: '2026-07-10T09:30:00.000Z',
    secretaryName: 'Secretary One',
    secretaryReviewedAt: '2026-07-03T09:30:00.000Z',
    secretaryNotes: 'Membership verified.',
    treasurerName: 'Treasurer One',
    treasurerReviewedAt: '2026-07-05T09:30:00.000Z',
    treasurerNotes: 'Repayment ability checked.',
    chairmanName: 'Chairman One'
  });

  assert.match(html, /LOAN APPLICATION, APPROVAL AND AGREEMENT/);
  assert.match(html, /KES 100,000\.00/);
  assert.match(html, /KES 12,000\.00/);
  assert.match(html, /KES 112,000\.00/);
  assert.match(html, /Flat interest calculated once on the original principal/);
  assert.match(html, /Secretary eligibility review/);
  assert.match(html, /Manual signatures/);
  assert.match(html, /Guarantor 1/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /Jane &lt;script&gt;alert/);
});

test('offers agreements only after final approval', () => {
  assert.equal(isLoanAgreementAvailable('ChairmanReview'), false);
  assert.equal(isLoanAgreementAvailable('Rejected'), false);
  assert.equal(isLoanAgreementAvailable('Active'), true);
  assert.equal(isLoanAgreementAvailable('Cleared'), true);
});
