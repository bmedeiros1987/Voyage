const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1';

export class GmailHistoryContinuityError extends Error {
  constructor(message = 'gmail_history_continuity_lost') {
    super(message);
    this.name = 'GmailHistoryContinuityError';
    this.code = 'GMAIL_HISTORY_CONTINUITY_LOST';
  }
}

export async function listGmailMessages(accessToken, { query = '', pageToken = null, maxResults = 100, fetchImpl = fetch } = {}) {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (pageToken) params.set('pageToken', pageToken);
  params.set('maxResults', String(Math.max(1, Math.min(500, Number(maxResults) || 100))));
  return gmailRequest(accessToken, `/users/me/messages?${params}`, { fetchImpl });
}

export async function getGmailMessage(accessToken, messageId, { format = 'full', metadataHeaders = [], fetchImpl = fetch } = {}) {
  if (!messageId) throw new Error('gmail_message_id_required');
  const params = new URLSearchParams({ format });
  for (const header of metadataHeaders) params.append('metadataHeaders', String(header));
  return gmailRequest(accessToken, `/users/me/messages/${encodeURIComponent(messageId)}?${params}`, { fetchImpl });
}

export async function getGmailAttachment(accessToken, messageId, attachmentId, { fetchImpl = fetch } = {}) {
  if (!messageId || !attachmentId) throw new Error('gmail_attachment_id_required');
  const result = await gmailRequest(accessToken, `/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`, { fetchImpl });
  return Object.freeze({
    size: Number(result.size || 0),
    bytes: decodeBase64Url(result.data || '')
  });
}

export async function listGmailHistory(accessToken, startHistoryId, { pageToken = null, maxResults = 500, historyTypes = ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved'], fetchImpl = fetch } = {}) {
  if (!startHistoryId) throw new Error('gmail_history_id_required');
  const params = new URLSearchParams({ startHistoryId: String(startHistoryId), maxResults: String(Math.max(1, Math.min(500, Number(maxResults) || 500))) });
  if (pageToken) params.set('pageToken', pageToken);
  for (const type of historyTypes) params.append('historyTypes', type);
  try {
    return await gmailRequest(accessToken, `/users/me/history?${params}`, { fetchImpl });
  } catch (error) {
    if (error?.status === 404) throw new GmailHistoryContinuityError();
    throw error;
  }
}

export async function collectGmailHistoryDelta(accessToken, startHistoryId, { maxPages = 20, fetchImpl = fetch } = {}) {
  let pageToken = null;
  let newestHistoryId = String(startHistoryId);
  const messageIds = new Set();
  const deletedMessageIds = new Set();
  let pages = 0;

  do {
    if (pages >= maxPages) throw new Error('gmail_history_page_limit_exceeded');
    const page = await listGmailHistory(accessToken, startHistoryId, { pageToken, fetchImpl });
    pages += 1;
    newestHistoryId = page.historyId ? String(page.historyId) : newestHistoryId;
    for (const item of page.history || []) {
      for (const entry of item.messagesAdded || []) if (entry.message?.id) messageIds.add(String(entry.message.id));
      for (const entry of item.messagesDeleted || []) if (entry.message?.id) deletedMessageIds.add(String(entry.message.id));
      for (const entry of item.labelsAdded || []) if (entry.message?.id) messageIds.add(String(entry.message.id));
      for (const entry of item.labelsRemoved || []) if (entry.message?.id) messageIds.add(String(entry.message.id));
    }
    pageToken = page.nextPageToken || null;
  } while (pageToken);

  for (const id of deletedMessageIds) messageIds.delete(id);
  return Object.freeze({
    startHistoryId: String(startHistoryId),
    newestHistoryId,
    messageIds: [...messageIds],
    deletedMessageIds: [...deletedMessageIds],
    pages
  });
}

export async function startGmailWatch(accessToken, topicName, { labelIds = ['INBOX'], labelFilterBehavior = 'include', fetchImpl = fetch } = {}) {
  if (!topicName) throw new Error('gmail_pubsub_topic_required');
  const payload = { topicName: String(topicName) };
  if (Array.isArray(labelIds) && labelIds.length) payload.labelIds = labelIds.map(String);
  if (labelFilterBehavior) payload.labelFilterBehavior = labelFilterBehavior;
  const result = await gmailRequest(accessToken, '/users/me/watch', { method: 'POST', body: payload, fetchImpl });
  return Object.freeze({
    historyId: String(result.historyId || ''),
    expiration: normalizeExpiration(result.expiration)
  });
}

export async function stopGmailWatch(accessToken, { fetchImpl = fetch } = {}) {
  await gmailRequest(accessToken, '/users/me/stop', { method: 'POST', body: {}, fetchImpl, allowEmpty: true });
  return true;
}

export function shouldRenewGmailWatch(expiration, { now = Date.now(), renewBeforeMs = 24 * 60 * 60 * 1000 } = {}) {
  const expirationMs = typeof expiration === 'number' ? expiration : new Date(expiration || 0).getTime();
  return !Number.isFinite(expirationMs) || expirationMs <= now + renewBeforeMs;
}

export function normalizeGmailMessage(message = {}) {
  const headers = Object.fromEntries((message.payload?.headers || []).map((header) => [String(header.name || '').toLowerCase(), String(header.value || '')]));
  const attachments = [];
  const textParts = [];
  walkParts(message.payload, { attachments, textParts });
  return Object.freeze({
    id: message.id ? String(message.id) : null,
    threadId: message.threadId ? String(message.threadId) : null,
    historyId: message.historyId ? String(message.historyId) : null,
    internalDate: normalizeEpochMillis(message.internalDate),
    from: headers.from || '',
    to: headers.to || '',
    subject: headers.subject || '',
    date: headers.date || '',
    snippet: String(message.snippet || ''),
    bodyPreview: textParts.join('\n').replace(/\s+/g, ' ').trim().slice(0, 12000),
    attachments
  });
}

function walkParts(part, output) {
  if (!part) return;
  const filename = String(part.filename || '');
  const body = part.body || {};
  if (filename && body.attachmentId) {
    output.attachments.push(Object.freeze({
      filename,
      mimeType: String(part.mimeType || 'application/octet-stream'),
      attachmentId: String(body.attachmentId),
      size: Number(body.size || 0)
    }));
  }
  if ((part.mimeType === 'text/plain' || part.mimeType === 'text/html') && body.data) {
    const decoded = decodeBase64Url(body.data).toString('utf8');
    output.textParts.push(part.mimeType === 'text/html' ? stripHtml(decoded) : decoded);
  }
  for (const child of part.parts || []) walkParts(child, output);
}

async function gmailRequest(accessToken, path, { method = 'GET', body = null, fetchImpl = fetch, allowEmpty = false } = {}) {
  if (!accessToken) throw new Error('gmail_access_token_required');
  const response = await fetchImpl(`${GMAIL_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      ...(body !== null ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body !== null ? { body: JSON.stringify(body) } : {})
  });
  if (!response.ok) {
    const error = new Error(`gmail_api_${response.status}`);
    error.status = response.status;
    error.code = response.status === 401 ? 'GMAIL_TOKEN_INVALID' : response.status === 403 ? 'GMAIL_FORBIDDEN' : response.status === 404 ? 'GMAIL_NOT_FOUND' : 'GMAIL_API_ERROR';
    try { error.details = await response.json(); } catch { error.details = null; }
    throw error;
  }
  if (response.status === 204 || allowEmpty) {
    try { return await response.json(); } catch { return {}; }
  }
  return response.json();
}

function decodeBase64Url(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 ? '='.repeat(4 - (normalized.length % 4)) : '';
  return Buffer.from(`${normalized}${padding}`, 'base64');
}

function stripHtml(value) {
  return String(value || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/\s+/g, ' ').trim();
}

function normalizeExpiration(value) {
  const milliseconds = Number(value);
  return Number.isFinite(milliseconds) && milliseconds > 0 ? new Date(milliseconds).toISOString() : null;
}

function normalizeEpochMillis(value) {
  const milliseconds = Number(value);
  return Number.isFinite(milliseconds) && milliseconds > 0 ? new Date(milliseconds).toISOString() : null;
}
