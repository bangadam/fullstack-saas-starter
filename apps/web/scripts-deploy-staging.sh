#!/bin/bash
# Deploy web staging: the Cloudflare Vite plugin redirects wrangler to the
# generated dist/server/wrangler.json, which ignores env.staging — patch it.
set -e
pnpm build
node -e "
const fs = require('fs')
const p = 'dist/server/wrangler.json'
const c = JSON.parse(fs.readFileSync(p, 'utf8'))
c.name = 'saas-web-staging'
c.services = [{ binding: 'API_WORKER', service: 'saas-api-staging' }]
fs.writeFileSync(p, JSON.stringify(c))
"
npx wrangler deploy
