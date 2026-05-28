// ════════════════════════════════════════════════════════════════════════════
// client.ts — Google Sheets API auth + client.
// Uses a service account scoped to the Sheets API only.
// ════════════════════════════════════════════════════════════════════════════

import { existsSync } from 'node:fs';
import { google, type sheets_v4 } from 'googleapis';

export function isSheetsConfigured(spreadsheetId: string, serviceAccountPath: string): boolean {
  return Boolean(spreadsheetId) && Boolean(serviceAccountPath) && existsSync(serviceAccountPath);
}

export async function getSheetsClient(serviceAccountPath: string): Promise<sheets_v4.Sheets> {
  if (!existsSync(serviceAccountPath)) {
    throw new Error(`Google service account key not found at "${serviceAccountPath}"`);
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: serviceAccountPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}
