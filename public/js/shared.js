// ── shared.js — helpers available on every page ───────────────────────────────

// XSS-safe HTML escaping
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// "my_league" → "My League"
function formatLeagueName(slug) {
  return slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// 1 → "1st", 2 → "2nd", etc.
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// Short date+time  e.g. "14 Mar 09:45"
function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// Long date  e.g. "14 March 2026"
function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric', month: 'long', year: 'numeric'
  });
}

// Minimal fetch wrapper — throws on non-2xx
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(path, opts);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}

/**
 * Wire up a file-input avatar uploader.
 *   inputSelector  — querySelector for the <input type="file">
 *   wrapSelector   — querySelector for the loading-overlay wrapper
 *   imgSelector    — querySelector for the <img> to refresh after upload
 *   getUrl(dataset)— function returning the POST URL, receives input.dataset
 *   onSuccess(avatarUrl, dataset) — optional callback after a successful upload
 */
function wireAvatarUpload(inputSelector, wrapSelector, imgSelector, getUrl, onSuccess) {
  const fileInput = document.querySelector(inputSelector);
  if (!fileInput) return;
  fileInput.addEventListener('change', async function () {
    if (!this.files[0]) return;
    const formData = new FormData();
    formData.append('avatar', this.files[0]);
    const wrap = document.querySelector(wrapSelector);
    if (wrap) wrap.classList.add('uploading');
    try {
      const r = await fetch(getUrl(this.dataset), { method: 'POST', body: formData });
      if (!r.ok) throw new Error((await r.json()).error || 'Upload failed');
      const { avatarUrl } = await r.json();
      document.querySelector(imgSelector).src = avatarUrl;
      if (onSuccess) onSuccess(avatarUrl, this.dataset);
    } catch (e) {
      alert('Upload failed: ' + e.message);
    } finally {
      if (wrap) wrap.classList.remove('uploading');
      this.value = '';
    }
  });
}

