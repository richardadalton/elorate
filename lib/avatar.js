const fs     = require('fs');
const path   = require('path');
const multer = require('multer');
const sharp  = require('sharp');

const AVATAR_MAX_BYTES  = 5 * 1024 * 1024; // 5 MB upload limit
const AVATAR_CACHE_SECS = 86400;            // 24 h browser cache for uploaded avatars

/** Generate an SVG with coloured circle + initials as a fallback avatar. */
function generateAvatarSvg(name, colourKey) {
  const initials = name
    ? name.trim().split(/\s+/).map(w => w[0].toUpperCase()).slice(0, 2).join('')
    : '?';
  const colours = ['#16a34a', '#0d9488', '#2563eb', '#7c3aed', '#c2410c', '#b45309'];
  const colour  = colours[colourKey.charCodeAt(0) % colours.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
    <circle cx="100" cy="100" r="100" fill="${colour}"/>
    <text x="100" y="100" font-family="system-ui,sans-serif" font-size="80"
          font-weight="700" fill="white" text-anchor="middle" dominant-baseline="central">${initials}</text>
  </svg>`;
}

/** Resize an image buffer to a 200×200 JPEG and save it to disk. */
async function saveAvatar(buffer, savePath) {
  const dir = path.dirname(savePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  await sharp(buffer)
    .resize(200, 200, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 85 })
    .toFile(savePath);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AVATAR_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  }
});

module.exports = { AVATAR_CACHE_SECS, generateAvatarSvg, saveAvatar, upload };
