// ─── Unit tests for network request parsing functions ───

import { describe, it, expect } from 'vitest';
import {
  parseBody,
  detectEncoding,
  getContentType,
} from '../../src/network-capture';

// ────────────────────────────────────────────────────────────────
// getContentType
// ────────────────────────────────────────────────────────────────

describe('getContentType', () => {
  it('extracts Content-Type header (standard casing)', () => {
    expect(getContentType({ 'Content-Type': 'application/json' })).toBe('application/json');
  });

  it('is case-insensitive on header name', () => {
    expect(getContentType({ 'content-type': 'text/html' })).toBe('text/html');
    expect(getContentType({ 'CONTENT-TYPE': 'text/plain' })).toBe('text/plain');
  });

  it('lowercases the returned value', () => {
    expect(getContentType({ 'Content-Type': 'Application/JSON' })).toBe('application/json');
  });

  it('returns empty string when header is missing', () => {
    expect(getContentType({})).toBe('');
    expect(getContentType({ 'Accept': 'text/html' })).toBe('');
  });

  it('handles headers with charset parameter', () => {
    const result = getContentType({ 'Content-Type': 'application/json; charset=utf-8' });
    expect(result).toContain('application/json');
    expect(result).toContain('charset=utf-8');
  });
});

// ────────────────────────────────────────────────────────────────
// parseBody
// ────────────────────────────────────────────────────────────────

describe('parseBody', () => {
  it('returns null for null postData', () => {
    expect(parseBody(null, {})).toBeNull();
  });

  it('returns null for undefined postData', () => {
    expect(parseBody(undefined, {})).toBeNull();
  });

  it('returns null for empty string postData', () => {
    expect(parseBody('', {})).toBeNull();
  });

  // JSON parsing
  it('parses valid JSON body', () => {
    const headers = { 'Content-Type': 'application/json' };
    const body = JSON.stringify({ username: 'john', age: 30 });
    const result = parseBody(body, headers);
    expect(result).toEqual({ username: 'john', age: 30 });
  });

  it('parses JSON with nested objects', () => {
    const headers = { 'Content-Type': 'application/json' };
    const body = JSON.stringify({ user: { name: 'john', address: { city: 'NY' } } });
    const result = parseBody(body, headers);
    expect(result).toEqual({ user: { name: 'john', address: { city: 'NY' } } });
  });

  it('parses JSON with arrays', () => {
    const headers = { 'Content-Type': 'application/json' };
    const body = JSON.stringify({ items: [1, 2, 3] });
    const result = parseBody(body, headers);
    expect(result).toEqual({ items: [1, 2, 3] });
  });

  it('returns null for malformed JSON', () => {
    const headers = { 'Content-Type': 'application/json' };
    expect(parseBody('{invalid json', headers)).toBeNull();
  });

  it('handles JSON content type with charset', () => {
    const headers = { 'Content-Type': 'application/json; charset=utf-8' };
    const body = JSON.stringify({ key: 'value' });
    expect(parseBody(body, headers)).toEqual({ key: 'value' });
  });

  // Form-urlencoded parsing
  it('parses form-urlencoded body', () => {
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    const body = 'username=john&email=john%40example.com&message=hello+world';
    const result = parseBody(body, headers);
    expect(result).toEqual({
      username: 'john',
      email: 'john@example.com',
      message: 'hello world',
    });
  });

  it('parses form-urlencoded with empty values', () => {
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    const body = 'username=&email=';
    const result = parseBody(body, headers);
    expect(result).toEqual({ username: '', email: '' });
  });

  // Unsupported content types
  it('returns null for multipart content type', () => {
    const headers = { 'Content-Type': 'multipart/form-data; boundary=----WebKitFormBoundary' };
    expect(parseBody('--boundary\r\nContent-Disposition: form-data\r\n', headers)).toBeNull();
  });

  it('returns null for text/plain content type', () => {
    const headers = { 'Content-Type': 'text/plain' };
    expect(parseBody('some text content', headers)).toBeNull();
  });

  it('returns null when no content-type header present', () => {
    expect(parseBody('some body data', {})).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────
// detectEncoding
// ────────────────────────────────────────────────────────────────

describe('detectEncoding', () => {
  it('returns "none" for null postData', () => {
    expect(detectEncoding(null, {})).toBe('none');
  });

  it('returns "none" for undefined postData', () => {
    expect(detectEncoding(undefined, {})).toBe('none');
  });

  it('returns "none" for empty string postData', () => {
    expect(detectEncoding('', {})).toBe('none');
  });

  it('returns "json" for application/json', () => {
    expect(detectEncoding('{}', { 'Content-Type': 'application/json' })).toBe('json');
  });

  it('returns "json" for application/json with charset', () => {
    expect(detectEncoding('{}', { 'Content-Type': 'application/json; charset=utf-8' })).toBe('json');
  });

  it('returns "form-urlencoded" for x-www-form-urlencoded', () => {
    expect(detectEncoding('a=b', { 'Content-Type': 'application/x-www-form-urlencoded' })).toBe('form-urlencoded');
  });

  it('returns "multipart" for multipart/form-data', () => {
    expect(detectEncoding('data', { 'Content-Type': 'multipart/form-data; boundary=---' })).toBe('multipart');
  });

  it('returns "text" for unknown content types', () => {
    expect(detectEncoding('data', { 'Content-Type': 'text/plain' })).toBe('text');
  });

  it('returns "text" when content-type header is missing but body exists', () => {
    expect(detectEncoding('some data', {})).toBe('text');
  });
});
