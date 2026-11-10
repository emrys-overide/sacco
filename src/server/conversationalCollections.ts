// src/server/conversationalCollections.ts
// Conversational Intent & Aggregation Engine powered by Gemini

import { GoogleGenAI } from '@google/genai';
import { normalizeMpesaPhoneNumber, getDarajaConfig } from './darajaMpesa';

export interface MemberFinancialContext {
  memberId: string;
  fullName: string;
  phoneNumber: string;
  membershipNumber?: string;
  savingsBalance: number;
  loanBalance: number;
  activeLoans: Array<{
    id: string;
    amount: number;
    remainingBalance: number;
    dueDate?: string;
  }>;
}

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
}

export interface ConversationalResponse {
  reply: string;
  stage: 'INQUIRY' | 'COLLECTING_DETAILS' | 'AWAITING_CONFIRMATION' | 'TRIGGER_STK';
  proposal?: {
    transactionType: 'SAVINGS' | 'LOAN_REPAYMENT';
    accountReference: string;
    amount: number;
    phoneNumber: string;
    recipientShortcode: string;
  };
}

const SYSTEM_INSTRUCTION = `
You are the official Sowetamu SACCO Collections Assistant.
Your goal is to help the SACCO member make a Savings deposit or a Loan Repayment using M-Pesa STK Push.

Follow this strict dialog protocol:
1. Greet the member by name and acknowledge their status.
2. Inquire whether they wish to make a deposit to "Savings" or pay towards an existing "Loan".
3. If Loan Repayment:
   - Present their current outstanding loan balance.
   - Ask how much they would like to repay.
4. If Savings Deposit:
   - Present their current savings balance.
   - Ask how much they would like to deposit.
5. Once the purpose and amount are clear:
   - Present the clear aggregated breakdown:
     * Transaction Type: [Savings / Loan Repayment]
     * Account / Reference ID: [Member Number / Loan ID]
     * Total Payable: KES [Amount]
     * Recipient Till/Paybill: [SACCO Shortcode]
     * Target Phone Number: [Member MSISDN (2547...)]
   - Ask the member for explicit confirmation to proceed with the M-Pesa STK Push.
6. When the user confirms (e.g., "yes", "confirm", "proceed", "send prompt"):
   - Instruct the user: "An M-Pesa STK prompt has been sent to your phone. Please enter your M-Pesa PIN to complete the transaction."
   - Indicate that the payment is initiated.

Keep your tone professional, concise, respectful, and helpful. Always format amounts clearly with "KES".
`;

export async function processMemberChat(
  input: string,
  history: ChatMessage[],
  context: MemberFinancialContext
): Promise<ConversationalResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  const config = getDarajaConfig();
  const normalizedPhone = (() => {
    try {
      return normalizeMpesaPhoneNumber(context.phoneNumber);
    } catch {
      return context.phoneNumber || '254700000000';
    }
  })();

  // Fallback heuristic dialogue manager if GEMINI_API_KEY is not configured
  if (!apiKey) {
    return handleDeterministicDialogue(input, history, context, normalizedPhone, config.shortcode);
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const memberSummary = `
Member Profile:
- Name: ${context.fullName}
- Membership Number: ${context.membershipNumber || 'N/A'}
- Verified Phone: ${normalizedPhone}
- Current Savings Balance: KES ${context.savingsBalance.toLocaleString('en-KE')}
- Current Loan Balance: KES ${context.loanBalance.toLocaleString('en-KE')}
- Active Loans: ${JSON.stringify(context.activeLoans)}
- SACCO Shortcode: ${config.shortcode}
`;

    const contents = [
      { role: 'user', parts: [{ text: `${SYSTEM_INSTRUCTION}\n\n${memberSummary}` }] },
      { role: 'model', parts: [{ text: `Hello ${context.fullName}! How can I help you today? Would you like to contribute to your Savings or make a Loan Repayment?` }] },
      ...history.map(msg => ({
        role: msg.role === 'model' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      })),
      { role: 'user', parts: [{ text: input }] }
    ];

    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: contents as any
    });

    const replyText = response.text || "I'm here to assist you with your SACCO savings and loan repayments.";

    // Parse potential intent & proposals
    const intentHeuristic = parseProposalFromText(replyText, input, history, context, normalizedPhone, config.shortcode);

    return {
      reply: replyText,
      stage: intentHeuristic.stage,
      proposal: intentHeuristic.proposal
    };
  } catch (err) {
    console.warn('[Gemini Assistant] API call error, falling back to local handler:', err);
    return handleDeterministicDialogue(input, history, context, normalizedPhone, config.shortcode);
  }
}

function handleDeterministicDialogue(
  input: string,
  history: ChatMessage[],
  context: MemberFinancialContext,
  normalizedPhone: string,
  shortcode: string
): ConversationalResponse {
  const lower = input.toLowerCase().trim();

  // Check confirmation
  const isConfirm = /^(yes|confirm|proceed|pay|send prompt|ok|okay|sure|do it)/i.test(lower);
  const isSavings = /saving|deposit|contribute|contribution/i.test(lower);
  const isLoan = /loan|repay|repayment|borrow/i.test(lower);
  const cleanedText = lower.replace(/,/g, '');
  const amountMatch = cleanedText.match(/(?:kes|ksh|\$)?\s*([0-9]{2,7})/);
  const amount = amountMatch ? parseInt(amountMatch[1], 10) : null;

  // Find previous proposal from history if awaiting confirmation
  const lastModelMsg = [...history].reverse().find(m => m.role === 'model')?.content || '';
  const wasAwaitingConfirmation = lastModelMsg.includes('Aggregated Breakdown') || lastModelMsg.includes('Total Payable');

  if (wasAwaitingConfirmation && isConfirm) {
    const isLoanPrevious = lastModelMsg.toLowerCase().includes('loan');
    const prevAmountMatch = lastModelMsg.match(/Total Payable:\s*KES\s*([0-9,]+)/i);
    const resolvedAmount = prevAmountMatch ? parseInt(prevAmountMatch[1].replace(/,/g, ''), 10) : 500;
    const type = isLoanPrevious ? 'LOAN_REPAYMENT' : 'SAVINGS';
    const ref = isLoanPrevious && context.activeLoans[0] ? context.activeLoans[0].id : (context.membershipNumber || context.memberId.slice(0, 8));

    return {
      reply: `An M-Pesa STK prompt has been sent to your phone (${normalizedPhone}). Please enter your M-Pesa PIN to complete the transaction of KES ${resolvedAmount.toLocaleString('en-KE')}.`,
      stage: 'TRIGGER_STK',
      proposal: {
        transactionType: type,
        accountReference: ref,
        amount: resolvedAmount,
        phoneNumber: normalizedPhone,
        recipientShortcode: shortcode
      }
    };
  }

  // If user specified an amount or intent
  if (amount && (isSavings || (!isLoan && !wasAwaitingConfirmation))) {
    return {
      reply: `Here is your Aggregated Breakdown:\n` +
        `• Transaction Type: Savings Deposit\n` +
        `• Account / Reference ID: ${context.membershipNumber || context.memberId.slice(0, 8)}\n` +
        `• Total Payable: KES ${amount.toLocaleString('en-KE')}\n` +
        `• Recipient Till/Paybill: ${shortcode}\n` +
        `• Target Phone Number: ${normalizedPhone}\n\n` +
        `Would you like me to send the M-Pesa STK prompt to your phone? Reply "Confirm" to proceed.`,
      stage: 'AWAITING_CONFIRMATION',
      proposal: {
        transactionType: 'SAVINGS',
        accountReference: context.membershipNumber || context.memberId.slice(0, 8),
        amount,
        phoneNumber: normalizedPhone,
        recipientShortcode: shortcode
      }
    };
  }

  if (amount && isLoan) {
    const loanRef = context.activeLoans[0]?.id || context.memberId.slice(0, 8);
    return {
      reply: `Here is your Aggregated Breakdown:\n` +
        `• Transaction Type: Loan Repayment\n` +
        `• Account / Reference ID: ${loanRef}\n` +
        `• Total Payable: KES ${amount.toLocaleString('en-KE')}\n` +
        `• Recipient Till/Paybill: ${shortcode}\n` +
        `• Target Phone Number: ${normalizedPhone}\n\n` +
        `Would you like me to send the M-Pesa STK prompt to your phone? Reply "Confirm" to proceed.`,
      stage: 'AWAITING_CONFIRMATION',
      proposal: {
        transactionType: 'LOAN_REPAYMENT',
        accountReference: loanRef,
        amount,
        phoneNumber: normalizedPhone,
        recipientShortcode: shortcode
      }
    };
  }

  if (isLoan) {
    return {
      reply: `Your outstanding loan balance is KES ${context.loanBalance.toLocaleString('en-KE')}. How much would you like to repay today?`,
      stage: 'COLLECTING_DETAILS'
    };
  }

  if (isSavings) {
    return {
      reply: `Your current savings balance is KES ${context.savingsBalance.toLocaleString('en-KE')}. How much would you like to deposit today?`,
      stage: 'COLLECTING_DETAILS'
    };
  }

  return {
    reply: `Hello ${context.fullName}! Welcome to Sowetamu SACCO Collections Assistant. Would you like to deposit to your Savings (Current: KES ${context.savingsBalance.toLocaleString('en-KE')}) or make a Loan Repayment (Balance: KES ${context.loanBalance.toLocaleString('en-KE')})?`,
    stage: 'INQUIRY'
  };
}

function parseProposalFromText(
  replyText: string,
  userText: string,
  history: ChatMessage[],
  context: MemberFinancialContext,
  normalizedPhone: string,
  shortcode: string
): {
  stage: 'INQUIRY' | 'COLLECTING_DETAILS' | 'AWAITING_CONFIRMATION' | 'TRIGGER_STK';
  proposal?: ConversationalResponse['proposal'];
} {
  const lowerReply = replyText.toLowerCase();
  const lowerUser = userText.toLowerCase().trim();

  const isTrigger = lowerReply.includes('an m-pesa stk prompt has been sent') ||
    lowerReply.includes('stk prompt has been sent') ||
    (/^(yes|confirm|proceed|pay)/i.test(lowerUser) && history.some(h => h.content.includes('Total Payable')));

  if (isTrigger) {
    const isLoan = lowerReply.includes('loan') || history.some(h => h.content.toLowerCase().includes('loan repayment'));
    const amountMatch = replyText.match(/(?:kes|ksh)\s*([0-9,]+)/i) ||
      [...history].reverse().find(h => h.content.match(/(?:kes|ksh)\s*([0-9,]+)/i))?.content.match(/(?:kes|ksh)\s*([0-9,]+)/i);
    const amount = amountMatch ? parseInt(amountMatch[1].replace(/,/g, ''), 10) : 500;
    const ref = isLoan && context.activeLoans[0] ? context.activeLoans[0].id : (context.membershipNumber || context.memberId.slice(0, 8));

    return {
      stage: 'TRIGGER_STK',
      proposal: {
        transactionType: isLoan ? 'LOAN_REPAYMENT' : 'SAVINGS',
        accountReference: ref,
        amount,
        phoneNumber: normalizedPhone,
        recipientShortcode: shortcode
      }
    };
  }

  if (lowerReply.includes('total payable') || lowerReply.includes('breakdown')) {
    const isLoan = lowerReply.includes('loan');
    const amountMatch = replyText.match(/Total Payable:\s*KES\s*([0-9,]+)/i) || replyText.match(/(?:kes|ksh)\s*([0-9,]+)/i);
    const amount = amountMatch ? parseInt(amountMatch[1].replace(/,/g, ''), 10) : 500;
    const ref = isLoan && context.activeLoans[0] ? context.activeLoans[0].id : (context.membershipNumber || context.memberId.slice(0, 8));

    return {
      stage: 'AWAITING_CONFIRMATION',
      proposal: {
        transactionType: isLoan ? 'LOAN_REPAYMENT' : 'SAVINGS',
        accountReference: ref,
        amount,
        phoneNumber: normalizedPhone,
        recipientShortcode: shortcode
      }
    };
  }

  if (lowerReply.includes('how much') || lowerReply.includes('amount')) {
    return { stage: 'COLLECTING_DETAILS' };
  }

  return { stage: 'INQUIRY' };
}
