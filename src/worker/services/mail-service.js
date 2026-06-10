import PostalMime, { decodeWords } from 'postal-mime';
import { deserializeRawEmail, serializeRawEmail, toArrayBuffer } from '../utils/raw-email.js';

const VERIFICATION_CODE_PATTERNS = [
  /(?:验证码|code|Code|CODE|passcode|token|pin)[\s:：-]*([a-zA-Z0-9]{4,8})\b/i,
  /\b(\d{4,8})\b/
];

function normalizeAddress(address, env) {
  const prefix = String(address || '').toLowerCase().trim().split('@')[0];
  const targetDomain = String(env.DOMAIN || 'example.com').toLowerCase().trim();
  return `${prefix}@${targetDomain}`;
}

function extractHeader(rawText, headerName) {
  const safeHeaderName = headerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = rawText.match(new RegExp(`^${safeHeaderName}:\\s*(.+)$`, 'im'));
  return match ? match[1].trim() : '';
}

function decodeHeader(value) {
  if (!value) {
    return '';
  }

  try {
    return decodeWords(value);
  } catch (_error) {
    return value;
  }
}

function htmlToText(html = '') {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildPreview(text = '', html = '') {
  const content = (text || htmlToText(html)).replace(/\s+/g, ' ').trim();
  return content.slice(0, 180);
}

function extractVerificationCode({ subject = '', text = '', html = '' }) {
  const haystack = [subject, text, htmlToText(html)].filter(Boolean).join(' ');

  for (const pattern of VERIFICATION_CODE_PATTERNS) {
    const match = haystack.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

function getFromAddress(parsed, rawText) {
  return (
    parsed?.from?.address ||
    decodeHeader(extractHeader(rawText, 'From')) ||
    'Unknown'
  );
}

function getSubject(parsed, rawText) {
  return parsed?.subject || decodeHeader(extractHeader(rawText, 'Subject')) || 'No Subject';
}

async function parseStoredEmail(rawEmail) {
  const { bytes, rawText, encoding } = deserializeRawEmail(rawEmail);

  try {
    const parsed = await PostalMime.parse(encoding === 'base64' ? toArrayBuffer(bytes) : rawText);
    return { parsed, rawText, encoding };
  } catch (error) {
    console.error('Failed to parse stored email, falling back to raw text:', error);
    return { parsed: null, rawText, encoding };
  }
}

function buildFormattedEmail(row, parsedResult) {
  const { parsed, rawText, encoding } = parsedResult;
  const text = parsed?.text || '';
  const html = parsed?.html || '';
  const subject = getSubject(parsed, rawText);
  const from = getFromAddress(parsed, rawText);

  return {
    id: row.id,
    created_at: row.created_at,
    from,
    subject,
    text,
    html,
    preview: buildPreview(text, html),
    verificationCode: extractVerificationCode({ subject, text, html }),
    attachmentCount: parsed?.attachments?.length || 0,
    raw_email: rawText,
    raw_email_encoding: encoding
  };
}

export async function ingestIncomingEmail(message, env) {
  const normalizedAddress = normalizeAddress(message.to, env);
  const rawEmailBuffer = await new Response(message.raw).arrayBuffer();
  const serializedRawEmail = serializeRawEmail(rawEmailBuffer);

  try {
    const parsed = await PostalMime.parse(rawEmailBuffer);
    console.log('Received email', {
      to: normalizedAddress,
      from: parsed?.from?.address || message.from,
      subject: parsed?.subject || '(no subject)'
    });
  } catch (error) {
    console.error('Incoming email parsing failed, storing raw content only:', error);
  }

  await env.DB.prepare(
    'INSERT INTO emails (address, raw_email) VALUES (?, ?)'
  ).bind(normalizedAddress, serializedRawEmail).run();
}

export async function listEmailsByAddress(address, env) {
  const prefix = String(address || '').toLowerCase().trim().split('@')[0];
  const { results } = await env.DB.prepare(
    'SELECT id, created_at, raw_email FROM emails WHERE address LIKE ? ORDER BY id DESC LIMIT 50'
  ).bind(`${prefix}@%`).all();

  const formattedResults = await Promise.all(
    results.map(async (row) => buildFormattedEmail(row, await parseStoredEmail(row.raw_email || '')))
  );

  return formattedResults;
}

export async function deleteEmailById(id, address, env) {
  const prefix = String(address || '').toLowerCase().trim().split('@')[0];

  await env.DB.prepare(
    'DELETE FROM emails WHERE id = ? AND address LIKE ?'
  ).bind(id, `${prefix}@%`).run();
}

export function getPublicConfig(env) {
  return {
    domain: String(env.DOMAIN || 'example.com').toLowerCase().trim(),
    pollIntervalMs: 15000
  };
}
