import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const schemasDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'schemas');

/** @returns {{ ajv: import('ajv').default, validators: Record<string, import('ajv').ValidateFunction> }} */
export function loadValidators() {
  // strictRequired is relaxed because conditional (if/then) required-fields are a
  // deliberate pattern in these schemas; all other ajv strict checks stay on.
  const ajv = new /** @type {any} */ (Ajv)({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
  /** @type {any} */ (addFormats)(ajv);
  /** @type {Record<string, import('ajv').ValidateFunction>} */
  const validators = {};
  for (const file of readdirSync(schemasDir)) {
    if (!file.endsWith('.schema.json')) continue;
    const schema = JSON.parse(readFileSync(path.join(schemasDir, file), 'utf8'));
    const key = file.replace('.schema.json', '');
    validators[key] = ajv.compile(schema);
  }
  return { ajv, validators };
}

/**
 * @param {import('ajv').ValidateFunction} validator
 * @param {unknown} data
 * @returns {string[]} human-readable schema violations, empty when valid
 */
export function schemaErrors(validator, data) {
  if (validator(data)) return [];
  return (validator.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`);
}
