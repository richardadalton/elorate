# Use a specific Node LTS version so the environment is always identical
FROM node:22-alpine

WORKDIR /app

# Copy dependency manifests first so Docker can cache the npm install layer.
# The layer is only invalidated if package.json or package-lock.json change.
COPY package*.json ./

# Install production dependencies only (no devDependencies / Playwright etc.)
# sharp 0.34+ ships pre-built binaries for Alpine — no native compile step needed.
RUN npm ci --omit=dev

# Copy the rest of the source
COPY . .

# The port the Express server listens on
EXPOSE 3000

# DATA_DIR is where league data is stored.
# Override this to point at a Docker volume (see docker-compose.yml).
ENV DATA_DIR=/app/data

CMD ["node", "index.js"]


