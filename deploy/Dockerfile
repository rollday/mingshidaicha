FROM node:24-bookworm-slim

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/venv
COPY python/requirements.txt /tmp/requirements.txt
RUN /opt/venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json frontend/package.json
RUN corepack enable && corepack prepare pnpm@12.14.0 --activate \
    && pnpm install --prod --frozen-lockfile
COPY dist ./dist
COPY python ./python
COPY public ./public
COPY data ./data
ENV NODE_ENV=production HOST=0.0.0.0 PORT=18987 PYTHON_BIN=/opt/venv/bin/python
USER node
EXPOSE 18987
CMD ["node", "dist/src/index.js"]
