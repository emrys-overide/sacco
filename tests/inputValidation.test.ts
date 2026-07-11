import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isValidKenyanVehiclePlate,
  isValidPersonName,
  isValidPhoneNumber,
  sanitizeDecimalInput,
  sanitizeIntegerInput,
  sanitizePersonName,
  sanitizePhoneNumber,
  sanitizeReferenceCode,
  sanitizeVehiclePlate
} from '../src/lib/inputValidation';
import { requiresRegisteredMember } from '../src/lib/transactionPolicy';

test('keeps name-only fields free of digits and preserves valid name punctuation', () => {
  assert.equal(sanitizePersonName("Mary2 O'Neil-3"), "Mary O'Neil-");
  assert.equal(isValidPersonName("Mary O'Neil"), true);
  assert.equal(isValidPersonName('Mary 2026'), false);
});

test('keeps identifier, phone, and money fields numeric', () => {
  assert.equal(sanitizeIntegerInput('12A-34 56'), '123456');
  assert.equal(sanitizePhoneNumber('+254 712-ABC-345678'), '+254712345678');
  assert.equal(isValidPhoneNumber('+254712345678'), true);
  assert.equal(sanitizeDecimalInput('1e3.4x5'), '13.45');
});

test('retains mixed entry only for plates and reference codes', () => {
  assert.equal(sanitizeVehiclePlate('kcj@ 402x'), 'KCJ 402X');
  assert.equal(isValidKenyanVehiclePlate('KCJ 402X'), true);
  assert.equal(sanitizeReferenceCode('qg-12@ab'), 'QG-12AB');
});

test('requires a registered member for every non-expense transaction', () => {
  assert.equal(requiresRegisteredMember('Daily Contribution'), true);
  assert.equal(requiresRegisteredMember('Registration Fee'), true);
  assert.equal(requiresRegisteredMember('Management Fee'), true);
  assert.equal(requiresRegisteredMember('Penalty'), true);
  assert.equal(requiresRegisteredMember('Office Expenses'), false);
  assert.equal(requiresRegisteredMember('Petty Cash'), false);
  assert.equal(requiresRegisteredMember('Utilities'), false);
  assert.equal(requiresRegisteredMember('Equipment'), false);
});
