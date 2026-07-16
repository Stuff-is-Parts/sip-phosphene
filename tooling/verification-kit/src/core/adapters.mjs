import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { abs } from './paths.mjs';

/**
 * Resolve an adapter capability to its implementing module export.
 * @param {import('./store.mjs').Store} store
 * @param {string} adapterId
 * @param {string} capabilityId
 * @returns {{ ok: true, module: string } | { ok: false, reason: string }}
 */
export function resolveCapability(store, adapterId, capabilityId) {
  const adapter = store.adapters.find((a) => a.adapterId === adapterId);
  if (!adapter) return { ok: false, reason: `adapter '${adapterId}' not registered` };
  const cap = adapter.capabilities.find((/** @type {any} */ c) => c.capabilityId === capabilityId);
  if (!cap) return { ok: false, reason: `capability '${capabilityId}' not declared by adapter '${adapterId}'` };
  const moduleAbs = abs(store.repoRoot, cap.module);
  if (!existsSync(moduleAbs)) return { ok: false, reason: `capability module missing: ${cap.module}` };
  return { ok: true, module: cap.module };
}

/**
 * Invoke a capability implementation with a JSON payload; returns its JSON result.
 * @param {import('./store.mjs').Store} store
 * @param {string} adapterId
 * @param {string} capabilityId
 * @param {unknown} payload
 * @returns {Promise<{ ok: true, result: unknown } | { ok: false, reason: string }>}
 */
export async function invokeCapability(store, adapterId, capabilityId, payload) {
  const resolved = resolveCapability(store, adapterId, capabilityId);
  if (!resolved.ok) return resolved;
  const adapter = store.adapters.find((a) => a.adapterId === adapterId);
  const cap = adapter.capabilities.find((/** @type {any} */ c) => c.capabilityId === capabilityId);
  try {
    const mod = await import(pathToFileURL(abs(store.repoRoot, cap.module)).href);
    const fn = mod[cap.export];
    if (typeof fn !== 'function') return { ok: false, reason: `export '${cap.export}' is not a function in ${cap.module}` };
    const result = await fn(payload);
    return { ok: true, result };
  } catch (e) {
    return { ok: false, reason: `capability failed: ${/** @type {Error} */ (e).message}` };
  }
}

/**
 * Invoke an evaluator entry point (a registered plausible-alternative implementation).
 * @param {import('./store.mjs').Store} store
 * @param {any} evaluator
 * @param {unknown} payload
 * @returns {Promise<{ ok: true, result: unknown } | { ok: false, reason: string }>}
 */
export async function invokeEvaluator(store, evaluator, payload) {
  const moduleAbs = abs(store.repoRoot, evaluator.entryPoint.module);
  if (!existsSync(moduleAbs)) return { ok: false, reason: `evaluator module missing: ${evaluator.entryPoint.module}` };
  try {
    const mod = await import(pathToFileURL(moduleAbs).href);
    const fn = mod[evaluator.entryPoint.export];
    if (typeof fn !== 'function') return { ok: false, reason: `export '${evaluator.entryPoint.export}' is not a function in ${evaluator.entryPoint.module}` };
    const result = await fn(payload);
    return { ok: true, result };
  } catch (e) {
    return { ok: false, reason: `evaluator failed: ${/** @type {Error} */ (e).message}` };
  }
}
