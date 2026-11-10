// src/server/darajaMpesa.ts
// Safaricom Daraja M-Pesa Express (STK Push) Integration Engine

export interface DarajaConfig {
  environment: 'sandbox' | 'production';
  consumerKey: string;
  consumerSecret: string;
  passkey: string;
  shortcode: string;
  callbackUrl: string;
}

export interface StkPushRequestParams {
  phoneNumber: string;
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

export interface StkQueryResult {
  merchantRequestId: string;
  checkoutRequestId: string;
  responseCode: string;
  responseDescription: string;
  resultCode: number;
  resultDesc: string;
  mpesaReceiptNumber?: string;
}

export interface MpesaCallbackPayload {
  Body: {
    stkCallback: {
      MerchantRequestID: string;
      CheckoutRequestID: string;
      ResultCode: number;
      ResultDesc: string;
      CallbackMetadata?: {
        Item: Array<{
          Name: string;
          Value?: string | number;
        }>;
      };
    };
  };
}

let cachedToken: { token: string; expiresAt: number } | null = null;

export function getDarajaConfig(): DarajaConfig {
  return {
    environment: (process.env.MPESA_ENVIRONMENT as 'sandbox' | 'production') || 'sandbox',
    consumerKey: process.env.MPESA_CONSUMER_KEY || 'vI0Bis5GmtBHEKrRD12oLH4PSBwpjbrDAq7jS0NU3FeRWtNR',
    consumerSecret: process.env.MPESA_CONSUMER_SECRET || 'i2B7NMRUxJmBYMRltQ89u8iqS6SSk3eyQq26Ah7qTcrCSVedHpeBZHsLpbbWLNG9',
    passkey: process.env.MPESA_PASSKEY || 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919',
    shortcode: process.env.MPESA_SHORTCODE || '174379', // 174379 is the standard Daraja sandbox shortcode
    callbackUrl:
      process.env.MPESA_CALLBACK_URL ||
      `${process.env.APP_BASE_URL || 'https://sacco-vq1v.onrender.com'}/api/v1/mpesa/callback`
  };
}

export function normalizeMpesaPhoneNumber(phone: string): string {
  const cleaned = (phone || '').replace(/[^\d+]/g, '');
  let normalized = cleaned;
  if (normalized.startsWith('+254')) {
    normalized = normalized.slice(1);
  } else if (normalized.startsWith('0')) {
    normalized = `254${normalized.slice(1)}`;
  } else if (normalized.length === 9 && (normalized.startsWith('7') || normalized.startsWith('1'))) {
    normalized = `254${normalized}`;
  }

  if (!/^254(7|1)\d{8}$/.test(normalized)) {
    throw new Error(
      `Invalid Kenyan mobile number "${phone}". Format must be 2547XXXXXXXX or 2541XXXXXXXX.`
    );
  }
  return normalized;
}

export function getDarajaTimestamp(date = new Date()): string {
  // East Africa Time (EAT) is UTC+3
  const eat = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  const Y = eat.getUTCFullYear();
  const M = String(eat.getUTCMonth() + 1).padStart(2, '0');
  const D = String(eat.getUTCDate()).padStart(2, '0');
  const h = String(eat.getUTCHours()).padStart(2, '0');
  const m = String(eat.getUTCMinutes()).padStart(2, '0');
  const s = String(eat.getUTCSeconds()).padStart(2, '0');
  return `${Y}${M}${D}${h}${m}${s}`;
}

export function generateDarajaPassword(shortcode: string, passkey: string, timestamp: string): string {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
}

export async function getDarajaOAuthToken(config = getDarajaConfig()): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60 * 1000) {
    return cachedToken.token;
  }

  if (!config.consumerKey || !config.consumerSecret) {
    if (config.environment === 'production') {
      throw new Error('M-Pesa Consumer Key and Consumer Secret are required in production.');
    }
    // Return mock token for local dev/testing without credentials
    const mockToken = `mock_daraja_token_${now}`;
    cachedToken = { token: mockToken, expiresAt: now + 3500 * 1000 };
    return mockToken;
  }

  const baseUrl =
    config.environment === 'production'
      ? 'https://api.safaricom.co.ke'
      : 'https://sandbox.safaricom.co.ke';

  const auth = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64');
  const res = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: {
      Authorization: `Basic ${auth}`
    }
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Daraja OAuth token request failed (${res.status}): ${errorText}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: string };
  const expiresInSeconds = parseInt(data.expires_in, 10) || 3599;
  cachedToken = {
    token: data.access_token,
    expiresAt: now + (expiresInSeconds - 60) * 1000
  };
  return cachedToken.token;
}

export async function initiateStkPush(
  params: StkPushRequestParams,
  config = getDarajaConfig()
): Promise<StkPushResult> {
  const normalizedPhone = normalizeMpesaPhoneNumber(params.phoneNumber);
  const roundedAmount = Math.max(1, Math.round(params.amount));
  const timestamp = getDarajaTimestamp();

  // If no passkey or credentials in sandbox/local, return a mock STK push result
  if (process.env.SACCO_TEST_MODE === 'true' || !config.consumerKey || !config.consumerSecret || !config.passkey) {
    if (config.environment === 'production') {
      throw new Error('Production Daraja configuration missing consumerKey, consumerSecret, or passkey.');
    }
    const mockCheckoutId = `ws_CO_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const mockMerchantId = `MERCHANT_${Date.now()}`;
    return {
      merchantRequestId: mockMerchantId,
      checkoutRequestId: mockCheckoutId,
      responseCode: '0',
      responseDescription: 'Success. Request accepted for processing',
      customerMessage: 'Success. Request accepted for processing'
    };
  }

  const token = await getDarajaOAuthToken(config);
  const password = generateDarajaPassword(config.shortcode, config.passkey, timestamp);

  const baseUrl =
    config.environment === 'production'
      ? 'https://api.safaricom.co.ke'
      : 'https://sandbox.safaricom.co.ke';

  const body = {
    BusinessShortCode: config.shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: roundedAmount,
    PartyA: normalizedPhone,
    PartyB: config.shortcode,
    PhoneNumber: normalizedPhone,
    CallBackURL: config.callbackUrl,
    AccountReference: (params.accountReference || 'SACCO').slice(0, 12),
    TransactionDesc: (params.transactionDesc || 'SACCO Daily Collection').slice(0, 100)
  };

  const res = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = (await res.json()) as {
    MerchantRequestID: string;
    CheckoutRequestID: string;
    ResponseCode: string;
    ResponseDescription: string;
    CustomerMessage: string;
    errorMessage?: string;
  };

  if (!res.ok || data.ResponseCode !== '0') {
    throw new Error(
      `Daraja STK Push failed (${res.status}): ${data.errorMessage || data.ResponseDescription || 'Unknown error'}`
    );
  }

  return {
    merchantRequestId: data.MerchantRequestID,
    checkoutRequestId: data.CheckoutRequestID,
    responseCode: data.ResponseCode,
    responseDescription: data.ResponseDescription,
    customerMessage: data.CustomerMessage
  };
}

export async function queryDarajaStkStatus(
  checkoutRequestId: string,
  config = getDarajaConfig()
): Promise<StkQueryResult> {
  const timestamp = getDarajaTimestamp();

  if (process.env.SACCO_TEST_MODE === 'true' || !config.consumerKey || !config.consumerSecret || !config.passkey) {
    return {
      merchantRequestId: 'MOCK_MERCHANT',
      checkoutRequestId,
      responseCode: '0',
      responseDescription: 'Simulated query response',
      resultCode: 0,
      resultDesc: 'The service request is processed successfully.'
    };
  }

  const token = await getDarajaOAuthToken(config);
  const password = generateDarajaPassword(config.shortcode, config.passkey, timestamp);

  const baseUrl =
    config.environment === 'production'
      ? 'https://api.safaricom.co.ke'
      : 'https://sandbox.safaricom.co.ke';

  const body = {
    BusinessShortCode: config.shortcode,
    Password: password,
    Timestamp: timestamp,
    CheckoutRequestID: checkoutRequestId
  };

  const res = await fetch(`${baseUrl}/mpesa/stkpushquery/v1/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = (await res.json()) as {
    MerchantRequestID: string;
    CheckoutRequestID: string;
    ResponseCode: string;
    ResponseDescription: string;
    ResultCode: string | number;
    ResultDesc: string;
  };

  return {
    merchantRequestId: data.MerchantRequestID,
    checkoutRequestId: data.CheckoutRequestID,
    responseCode: data.ResponseCode,
    responseDescription: data.ResponseDescription,
    resultCode: Number(data.ResultCode),
    resultDesc: data.ResultDesc
  };
}

export function parseCallbackMetadata(metadata?: {
  Item: Array<{ Name: string; Value?: string | number }>;
}): {
  mpesaReceiptNumber?: string;
  amount?: number;
  transactionDate?: string;
  phoneNumber?: string;
} {
  if (!metadata || !metadata.Item) return {};
  const result: {
    mpesaReceiptNumber?: string;
    amount?: number;
    transactionDate?: string;
    phoneNumber?: string;
  } = {};

  for (const item of metadata.Item) {
    if (item.Name === 'MpesaReceiptNumber' && item.Value) {
      result.mpesaReceiptNumber = String(item.Value);
    } else if (item.Name === 'Amount' && item.Value !== undefined) {
      result.amount = Number(item.Value);
    } else if (item.Name === 'TransactionDate' && item.Value) {
      result.transactionDate = String(item.Value);
    } else if (item.Name === 'PhoneNumber' && item.Value) {
      result.phoneNumber = String(item.Value);
    }
  }

  return result;
}
