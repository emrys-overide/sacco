import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatPhoneNumber,
  generateMpesaPassword,
  generateMpesaTimestamp,
  parseMpesaStkCallback,
  parseMpesaC2bPayload,
  matchMpesaReference,
  MpesaError
} from '../src/server/mpesaDaraja';

test('formatPhoneNumber normalizes Kenyan phone numbers correctly', () => {
  assert.equal(formatPhoneNumber('0712345678'), '254712345678');
  assert.equal(formatPhoneNumber('0112345678'), '254112345678');
  assert.equal(formatPhoneNumber('254712345678'), '254712345678');
  assert.equal(formatPhoneNumber('  +254 712 345 678  '), '254712345678');

  assert.throws(() => formatPhoneNumber(''), (err: any) => err instanceof MpesaError && err.code === 'MPESA_PHONE_REQUIRED');
  assert.throws(() => formatPhoneNumber('12345'), (err: any) => err instanceof MpesaError && err.code === 'MPESA_PHONE_INVALID');
  assert.throws(() => formatPhoneNumber('0812345678'), (err: any) => err instanceof MpesaError && err.code === 'MPESA_PHONE_INVALID');
});

test('generateMpesaPassword produces correct Base64 encoding', () => {
  const shortcode = '174379';
  const passkey = 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919';
  const timestamp = '20261110210000';
  const expected = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');

  const actual = generateMpesaPassword(shortcode, passkey, timestamp);
  assert.equal(actual, expected);
});

test('generateMpesaTimestamp produces 14-digit format', () => {
  const ts = generateMpesaTimestamp(new Date('2026-11-10T15:04:05Z'));
  assert.match(ts, /^\d{14}$/);
  assert.equal(ts.length, 14);
});

test('parseMpesaStkCallback handles successful payment', () => {
  const samplePayload = {
    Body: {
      stkCallback: {
        MerchantRequestID: '29115-34620561-1',
        CheckoutRequestID: 'ws_CO_191220191020363925',
        ResultCode: 0,
        ResultDesc: 'The service request is processed successfully.',
        CallbackMetadata: {
          Item: [
            { Name: 'Amount', Value: 500.00 },
            { Name: 'MpesaReceiptNumber', Value: 'NLJ7RT61SV' },
            { Name: 'Balance' },
            { Name: 'TransactionDate', Value: 20191219102115 },
            { Name: 'PhoneNumber', Value: 254708374149 }
          ]
        }
      }
    }
  };

  const result = parseMpesaStkCallback(samplePayload);
  assert.equal(result.isSuccess, true);
  assert.equal(result.resultCode, 0);
  assert.equal(result.transId, 'NLJ7RT61SV');
  assert.equal(result.amount, 500);
  assert.equal(result.phoneNumber, '254708374149');
  assert.ok(result.transactionTime.startsWith('2019-12-19'));
});

test('parseMpesaStkCallback handles user cancelled request', () => {
  const samplePayload = {
    Body: {
      stkCallback: {
        MerchantRequestID: '29115-34620561-1',
        CheckoutRequestID: 'ws_CO_191220191020363925',
        ResultCode: 1032,
        ResultDesc: 'Request cancelled by user.'
      }
    }
  };

  const result = parseMpesaStkCallback(samplePayload);
  assert.equal(result.isSuccess, false);
  assert.equal(result.resultCode, 1032);
  assert.equal(result.amount, 0);
  assert.equal(result.transId, 'STK-ws_CO_191220191020363925');
});

test('parseMpesaC2bPayload handles incoming C2B confirmation', () => {
  const c2bPayload = {
    TransactionType: 'Pay Bill',
    TransID: 'RKTQDM7W6S',
    TransTime: '20261110210000',
    TransAmount: '1200.00',
    BusinessShortCode: '174379',
    BillRefNumber: 'KDA 456Z',
    InvoiceNumber: '',
    OrgAccountBalance: '45000.00',
    ThirdPartyTransID: '',
    MSISDN: '254722000000',
    FirstName: 'John',
    MiddleName: 'K',
    LastName: 'Doe'
  };

  const result = parseMpesaC2bPayload(c2bPayload);
  assert.equal(result.isSuccess, true);
  assert.equal(result.transId, 'RKTQDM7W6S');
  assert.equal(result.amount, 1200);
  assert.equal(result.accountReference, 'KDA 456Z');
  assert.equal(result.phoneNumber, '254722000000');
});

test('matchMpesaReference resolves vehicle plate and member ID', () => {
  const mockMembers = [
    { id: 'mem-1', name: 'Alice Wambui', membershipNumber: 'SOWE-001', idNumber: '12345678' }
  ];
  const mockVehicles = [
    { id: 'veh-1', plateNumber: 'KCA 123A', ownerId: 'mem-1', ownerName: 'Alice Wambui' }
  ];

  // Match plate with spaces
  const match1 = matchMpesaReference('kca 123a', mockMembers, mockVehicles);
  assert.equal(match1.matchMethod, 'Vehicle Plate');
  assert.equal(match1.vehiclePlate, 'KCA 123A');
  assert.equal(match1.memberId, 'mem-1');

  // Match membership number
  const match2 = matchMpesaReference('sowe-001', mockMembers, mockVehicles);
  assert.equal(match2.matchMethod, 'Member ID');
  assert.equal(match2.memberId, 'mem-1');

  // Unmatched
  const match3 = matchMpesaReference('UNKNOWN', mockMembers, mockVehicles);
  assert.equal(match3.matchMethod, 'None');
});

test('live handshake: acquires valid access token from Daraja sandbox', async () => {
  const { loadMpesaConfig, getMpesaAccessToken } = await import('../src/server/mpesaDaraja');
  const config = loadMpesaConfig();
  if (!config.enabled) return;
  const token = await getMpesaAccessToken(config);
  assert.ok(token && token.length > 10);
});

