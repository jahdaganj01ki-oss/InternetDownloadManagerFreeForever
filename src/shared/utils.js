'use strict';

function formatBytes(bytes, decimals = 2) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function formatSpeed(bytesPerSec) {
  return formatBytes(bytesPerSec) + '/s';
}

function formatETA(seconds) {
  if (!seconds || !isFinite(seconds) || seconds <= 0) return '--';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function getCategoryForUrl(url, categories) {
  try {
    const path = new URL(url).pathname;
    const ext = path.split('.').pop().toLowerCase();
    for (const [name, cat] of Object.entries(categories)) {
      if (name === 'General') continue;
      if (cat.exts.includes(ext)) return name;
    }
  } catch (_) {}
  return 'General';
}

function getFilenameFromUrl(url, contentDisposition) {
  if (contentDisposition) {
    const m = contentDisposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';\r\n]+)["']?/i);
    if (m && m[1]) return decodeURIComponent(m[1].trim());
  }
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length) {
      const name = decodeURIComponent(parts[parts.length - 1]);
      if (name && name !== '/') return name;
    }
  } catch (_) {}
  return 'download_' + Date.now();
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

module.exports = { formatBytes, formatSpeed, formatETA, getCategoryForUrl, getFilenameFromUrl, generateId };
