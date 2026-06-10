import PostalMime, { decodeWords } from 'postal-mime';
import { deserializeRawEmail, serializeRawEmail, toArrayBuffer } from '../utils/raw-email.js';

const VERIFICATION_KEYWORDS = ['验证码', 'verification code', 'code', 'passcode', 'token', 'otp', 'pin'];
const COMMON_NON_CODE_WORDS = new Set([
  'your',
  'code',
  'verification',
  'verify',
  'login',
  'secure',
  'account',
  'trae',
  'system',
  'mail'
]);

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

function normalizeCandidate(value) {
  return String(value || '').replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '');
}

function isLikelyVerificationCode(candidate) {
  const normalizedCandidate = normalizeCandidate(candidate);

  if (normalizedCandidate.length < 4 || normalizedCandidate.length > 10) {
    return false;
  }

  if (!/^[a-zA-Z0-9]+$/.test(normalizedCandidate)) {
    return false;
  }

  const lowerCandidate = normalizedCandidate.toLowerCase();
  if (COMMON_NON_CODE_WORDS.has(lowerCandidate)) {
    return false;
  }

  // Prefer tokens with digits, or short uppercase codes.
  if (/\d/.test(normalizedCandidate)) {
    return true;
  }

  return /^[A-Z]{4,8}$/.test(normalizedCandidate);
}

function extractKeywordAnchoredCode(sourceText) {
  const lines = String(sourceText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lowerLine = line.toLowerCase();
    const hasKeyword = VERIFICATION_KEYWORDS.some((keyword) => lowerLine.includes(keyword));

    if (!hasKeyword) {
      continue;
    }

    const nearbyText = [line, lines[index + 1] || '', lines[index + 2] || ''].join(' ');
    const candidates = nearbyText.match(/[A-Za-z0-9]{4,10}/g) || [];

    for (const candidate of candidates) {
      if (isLikelyVerificationCode(candidate)) {
        return normalizeCandidate(candidate);
      }
    }
  }

  return null;
}

function extractVerificationCode({ subject = '', text = '', html = '' }) {
  const textContent = [subject, text, htmlToText(html)].filter(Boolean).join('\n');
  const anchoredCode = extractKeywordAnchoredCode(textContent);

  if (anchoredCode) {
    return anchoredCode;
  }

  const numericMatch = textContent.match(/\b(\d{4,8})\b/g) || [];
  const uniqueNumericValues = [...new Set(numericMatch.map((item) => item.trim()))];

  if (uniqueNumericValues.length === 1) {
    return uniqueNumericValues[0];
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

export async function listKnownAddresses(env) {
  const { results } = await env.DB.prepare(
    `SELECT
       address,
       COUNT(*) AS email_count,
       MAX(created_at) AS latest_created_at,
       MAX(id) AS latest_id
     FROM emails
     GROUP BY address
     ORDER BY latest_id DESC
     LIMIT 30`
  ).all();

  return results.map((row) => ({
    address: row.address,
    prefix: String(row.address || '').split('@')[0] || '',
    emailCount: Number(row.email_count || 0),
    latestCreatedAt: row.latest_created_at || null
  }));
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
