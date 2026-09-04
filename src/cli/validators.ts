import { z } from 'zod';
import { normalizeCountryCode } from '../utils/email-validator.js';

export const boundedLimitSchema = (defaultLimit: number = 10, maxLimit: number = 100) =>
  z
    .union([z.string(), z.number()])
    .transform((val) => {
      const parsed = typeof val === 'number' ? val : parseInt(String(val).trim(), 10);
      if (isNaN(parsed) || !Number.isInteger(parsed)) {
        throw new Error('Limit must be a valid integer.');
      }
      return parsed;
    })
    .refine((val) => val >= 1, 'Limit must be at least 1.')
    .refine((val) => val <= maxLimit, `Limit cannot exceed safety maximum of ${maxLimit}.`)
    .default(defaultLimit);

export const countryCodeSchema = z
  .string()
  .trim()
  .min(2, 'Country code must be at least 2 characters.')
  .transform((val) => normalizeCountryCode(val) || val.toUpperCase())
  .default('US');

export const sanitizedStringSchema = (fieldName: string, minLength: number = 1, maxLength: number = 100) =>
  z
    .string()
    .trim()
    .min(minLength, `${fieldName} cannot be empty.`)
    .max(maxLength, `${fieldName} exceeds maximum length of ${maxLength} characters.`)
    .refine((val) => !/[<>{}\\]/.test(val), `${fieldName} contains invalid characters.`);

export const optionalUuidSchema = z
  .string()
  .trim()
  .refine(
    (val) => val === '' || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val),
    'Campaign ID must be a valid UUID.'
  )
  .optional();

export const cliInputSchemas = {
  boundedLimit: boundedLimitSchema,
  countryCode: countryCodeSchema,
  sanitizedString: sanitizedStringSchema,
  optionalUuid: optionalUuidSchema,
};
