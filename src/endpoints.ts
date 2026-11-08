import fs from 'node:fs';
import { ROOT } from './config.js';
import type { CapturedEndpoint } from './types.js';

const FILE = `${ROOT}/endpoints.json`;

export function readCaptured(): CapturedEndpoint[] {
  if (!fs.existsSync(FILE)) return [];
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(parsed) ? (parsed as CapturedEndpoint[]) : [];
  } catch {
    return [];
  }
}

export function writeCaptured(list: CapturedEndpoint[]): void {
  fs.writeFileSync(FILE, `${JSON.stringify(list, null, 2)}\n`, 'utf8');
}

export function endpointsFile(): string {
  return FILE;
}
