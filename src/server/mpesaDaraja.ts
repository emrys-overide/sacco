import crypto from 'node:crypto';
import type { PaymentMatchMethod, PaymentRecord } from '../types';

export interface MpesaConfig {
  enabled: boolean;
  environment: 'sandbox' | 'production';
  consumerKey: string;
  consumerSecret: string;
  shortcode: string;
  tillNumber?: string;
  transactionType?: 'CustomerPayBillOnline' | 'CustomerBuyGoodsOnline';
  passkey: string;
  callbackUrl: string;
}

export interface StkPushParams {
  phone: string;
  amount: number;
  accountReference: string;
  transactionDesc?: string;
}

export interface StkPushResult {
  merchantRequestId: string;
  checkoutRequestId: string;
  responseCode: string;
  responseDescription: string;
  customerMessage: string;
}

export interface NormalizedMpesaPayment {
  transId: string;
  amount: number;
  phoneNumber: string;
  accountReference: string;
  transactionTime: string;
  resultCode: number;
  resultDesc: string;
  isSuccess: boolean;
  rawPayload: unknown;
}

export class MpesaError extends Error {
  constructor(public status: number, message: string, public code: string) {
    super(message);
    this.name = 'MpesaError';
  }
}

// In-memory token cache
let cachedToken: { token: string; expiresAt: number } | null = null;

export function loadMpesaConfig(env: NodeJS.ProcessEnv = process.env): MpesaConfig {
  const consumerKey = String(env.MPESA_CONSUMER_KEY || 'vI0Bis5GmtBHEKrRD12oLH4PSBwpjbrDAq7jS0NU3FeRWtNR').trim();
  const consumerSecret = String(env.MPESA_CONSUMER_SECRET || 'i2B7NMRUxJmBYMRltQ89u8iqS6SSk3eyQq26Ah7qTcrCSVedHpeBZHsLpbbWLNG9').trim();
  const passkey = String(env.MPESA_PASSKEY || 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919').trim();
  const shortcode = String(env.MPESA_SHORTCODE || '174379').trim();
  const tillNumber = String(env.MPESA_TILL_NUMBER || shortcode).trim();
  const callbackUrl = String(env.MPESA_CALLBACK_URL || 'https://sacco-vq1v.onrender.com/api/mpesa/callback').trim();
  const environment = env.MPESA_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
  const defaultTxType = env.MPESA_TILL_NUMBER || environment === 'production' ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline';
  const transactionType = (env.MPESA_TRANSACTION_TYPE as 'CustomerPayBillOnline' | 'CustomerBuyGoodsOnline') || defaultTxType;
  const enabled = Boolean(consumerKey && consumerSecret && shortcode && passkey);

  return {
    enabled,
    environment,
    consumerKey,
    consumerSecret,
    shortcode,
    tillNumber,
    transactionType,
    passkey,
    callbackUrl
  };
}

export function formatPhoneNumber(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) {
    throw new MpesaError(400, 'Phone number is required.', 'MPESA_PHONE_REQUIRED');
  }

  if ((digits.startsWith('07') || digits.startsWith('01')) && digits.length === 10) {
    return `254${digits.slice(1)}`;
  }
  if ((digits.startsWith('7') || digits.startsWith('1')) && digits.length === 9) {
    return `254${digits}`;
  }
  if ((digits.startsWith('2547') || digits.startsWith('2541')) && digits.length === 12) {
    return digits;
  }

  throw new MpesaError(
    400,
    `Invalid Kenyan phone number (${phone}). Expected format: 07XXXXXXXX, 01XXXXXXXX, or 2547XXXXXXXX.`,
    'MPESA_PHONE_INVALID'
  );
}

export function generateMpesaTimestamp(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

export function generateMpesaPassword(shortcode: string, passkey: string, timestamp: string): string {
  const raw = `${shortcode}${passkey}${timestamp}`;
  return Buffer.from(raw).toString('base64');
}

export function getDarajaBaseUrl(environment: 'sandbox' | 'production'): string {
  return environment === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';
}

export async function getMpesaAccessToken(config: MpesaConfig = loadMpesaConfig()): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.token;
  }

  const credentials = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64');
  const baseUrl = getDarajaBaseUrl(config.environment);
  const url = `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${credentials}`,
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new MpesaError(
      response.status,
      `Failed to obtain M-Pesa access token from Daraja: ${errorText}`,
      'MPESA_AUTH_FAILED'
    );
  }

  const data = (await response.json()) as { access_token: string; expires_in: string | number };
  const expiresInSeconds = Number(data.expires_in) || 3599;

  cachedToken = {
    token: data.access_token,
    expiresAt: now + expiresInSeconds * 1000
  };

  return cachedToken.token;
}

export async function initiateStkPush(
  params: StkPushParams,
  config: MpesaConfig = loadMpesaConfig()
): Promise<StkPushResult> {
  if (!config.enabled) {
    throw new MpesaError(503, 'M-Pesa integration is not configured.', 'MPESA_NOT_CONFIGURED');
  }

  const formattedPhone = formatPhoneNumber(params.phone);
  const amount = Math.round(Number(params.amount));
  if (!amount || amount < 1) {
    throw new MpesaError(400, 'Amount must be at least 1 KES.', 'MPESA_AMOUNT_INVALID');
  }

  const token = await getMpesaAccessToken(config);
  const timestamp = generateMpesaTimestamp();
  const password = generateMpesaPassword(config.shortcode, config.passkey, timestamp);
  const baseUrl = getDarajaBaseUrl(config.environment);

  const payload = {
    BusinessShortCode: config.shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: config.transactionType || (config.environment === 'sandbox' ? 'CustomerPayBillOnline' : 'CustomerBuyGoodsOnline'),
    Amount: amount,
    PartyA: formattedPhone,
    PartyB: config.tillNumber || config.shortcode,
    PhoneNumber: formattedPhone,
    CallBackURL: config.callbackUrl,
    AccountReference: String(params.accountReference || 'SOWE-SACCO').trim().slice(0, 12),
    TransactionDesc: String(params.transactionDesc || 'Daily Sacco Contribution').trim().slice(0, 100)
  };

  const response = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const responseData = (await response.json()) as Record<string, any>;
  if (!response.ok || responseData.ResponseCode !== '0') {
    throw new MpesaError(
      response.status >= 400 ? response.status : 400,
      responseData.errorMessage || responseData.ResponseDescription || 'STK Push failed',
      responseData.errorCode || 'MPESA_STK_FAILED'
    );
  }

  return {
    merchantRequestId: String(responseData.MerchantRequestID || ''),
    checkoutRequestId: String(responseData.CheckoutRequestID || ''),
    responseCode: String(responseData.ResponseCode || '0'),
    responseDescription: String(responseData.ResponseDescription || ''),
    customerMessage: String(responseData.CustomerMessage || '')
  };
}

export function parseMpesaStkCallback(payload: unknown): NormalizedMpesaPayment {
  if (!payload || typeof payload !== 'object') {
    throw new MpesaError(400, 'Invalid M-Pesa callback payload.', 'MPESA_PAYLOAD_INVALID');
  }

  const body = (payload as Record<string, any>).Body?.stkCallback;
  if (!body) {
    throw new MpesaError(400, 'Malformed STK callback structure.', 'MPESA_PAYLOAD_INVALID');
  }

  const resultCode = Number(body.ResultCode);
  const resultDesc = String(body.ResultDesc || '');
  const isSuccess = resultCode === 0;

  let transId = `STK-${String(body.CheckoutRequestID || crypto.randomUUID())}`;
  let amount = 0;
  let phoneNumber = '';
  let transactionTime = new Date().toISOString();

  if (isSuccess && Array.isArray(body.CallbackMetadata?.Item)) {
    for (const item of body.CallbackMetadata.Item) {
      if (item.Name === 'MpesaReceiptNumber' && item.Value) {
        transId = String(item.Value).trim().toUpperCase();
      } else if (item.Name === 'Amount' && item.Value !== undefined) {
        amount = Number(item.Value);
      } else if (item.Name === 'PhoneNumber' && item.Value) {
        phoneNumber = String(item.Value);
      } else if (item.Name === 'TransactionDate' && item.Value) {
        const rawDate = String(item.Value);
        if (rawDate.length === 14) {
          const y = rawDate.slice(0, 4);
          const m = rawDate.slice(4, 6);
          const d = rawDate.slice(6, 8);
          const h = rawDate.slice(8, 10);
          const min = rawDate.slice(10, 12);
          const s = rawDate.slice(12, 14);
          transactionTime = new Date(`${y}-${m}-${d}T${h}:${min}:${s}Z`).toISOString();
        }
      }
    }
  }

  return {
    transId,
    amount,
    phoneNumber,
    accountReference: '',
    transactionTime,
    resultCode,
    resultDesc,
    isSuccess,
    rawPayload: payload
  };
}

export function parseMpesaC2bPayload(payload: unknown): NormalizedMpesaPayment {
  if (!payload || typeof payload !== 'object') {
    throw new MpesaError(400, 'Invalid C2B payload.', 'MPESA_PAYLOAD_INVALID');
  }

  const body = payload as Record<string, any>;
  const transId = String(body.TransID || '').trim().toUpperCase();
  if (!transId) {
    throw new MpesaError(400, 'TransID is required.', 'MPESA_PAYLOAD_INVALID');
  }

  const amount = Number(body.TransAmount || 0);
  const phoneNumber = String(body.MSISDN || '');
  const accountReference = String(body.BillRefNumber || '').trim();
  const rawDate = String(body.TransTime || '');
  let transactionTime = new Date().toISOString();

  if (rawDate.length === 14) {
    const y = rawDate.slice(0, 4);
    const m = rawDate.slice(4, 6);
    const d = rawDate.slice(6, 8);
    const h = rawDate.slice(8, 10);
    const min = rawDate.slice(10, 12);
    const s = rawDate.slice(12, 14);
    transactionTime = new Date(`${y}-${m}-${d}T${h}:${min}:${s}Z`).toISOString();
  }

  return {
    transId,
    amount,
    phoneNumber,
    accountReference,
    transactionTime,
    resultCode: 0,
    resultDesc: 'Success',
    isSuccess: true,
    rawPayload: payload
  };
}

export function matchMpesaReference(
  accountRef: string,
  members: Array<{ id: string; name: string; membershipNumber?: string; idNumber?: string; phoneNumber?: string }>,
  vehicles: Array<{ id: string; plateNumber: string; ownerId: string; ownerName: string }>
): {
  memberId?: string;
  memberName?: string;
  vehicleId?: string;
  vehiclePlate?: string;
  matchMethod: PaymentMatchMethod;
} {
  const cleanRef = accountRef.toUpperCase().replace(/\s+/g, '');
  if (!cleanRef) {
    return { matchMethod: 'None' };
  }

  // 1. Vehicle Plate match
  const vehicle = vehicles.find(v => v.plateNumber.toUpperCase().replace(/\s+/g, '') === cleanRef);
  if (vehicle) {
    const member = members.find(m => m.id === vehicle.ownerId);
    return {
      vehicleId: vehicle.id,
      vehiclePlate: vehicle.plateNumber,
      memberId: vehicle.ownerId || member?.id,
      memberName: vehicle.ownerName || member?.name,
      matchMethod: 'Vehicle Plate'
    };
  }

  // 2. Member Membership Number match
  const memberByNo = members.find(m => m.membershipNumber && m.membershipNumber.toUpperCase().replace(/\s+/g, '') === cleanRef);
  if (memberByNo) {
    return {
      memberId: memberByNo.id,
      memberName: memberByNo.name,
      matchMethod: 'Member ID'
    };
  }

  // 3. National ID match
  const memberById = members.find(m => m.idNumber && m.idNumber.replace(/\s+/g, '') === cleanRef);
  if (memberById) {
    return {
      memberId: memberById.id,
      memberName: memberById.name,
      matchMethod: 'Member ID'
    };
  }

  return { matchMethod: 'None' };
}
