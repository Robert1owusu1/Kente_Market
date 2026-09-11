# Kente Marketplace — DigitalOcean Deployment ($0 via Student Pack)

Runs MySQL + Node (Express) + Nginx + Certbot on a DigitalOcean droplet ($200 free credit via GitHub Student Pack).

---

## 1. Create SSH key (on your local machine)

```bash
ssh-keygen -t ed25519 -f ~/.ssh/kente_deploy
cat ~/.ssh/kente_deploy.pub
# copy the output
```

## 2. DigitalOcean droplet

- Log into https://cloud.digitalocean.com → **Create** → **Droplets**
- Image: **Ubuntu 24.04 (LTS)**
- Plan: **Basic** → **Regular** → **$12/mo (2 GB RAM / 1 vCPU / 50 GB disk)**
  - $200 credit = ~16 months free
- Region: choose closest to your users
- Authentication: **SSH keys** → paste `kente_deploy.pub`
- Hostname: `kente-marketplace`
- Click **Create Droplet**
- Note the **public IP** (`143.xxx.xxx.xxx`)

## 3. Namecheap domain (free `.me` via Student Pack)

- Go to https://www.namecheap.com → claim your free `.me` domain from the Student Pack
- Set **DNS A record**: `@` → your droplet public IP (TTL 300)
- Wait 1–2 min for propagation: `dig +short yourdomain.me` should return the IP

## 4. SSH into the droplet

```bash
ssh -i ~/.ssh/kente_deploy root@<DROPLET_IP>
```

## 5. Base packages + firewall

```bash
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable -y
apt update && apt upgrade -y
apt install -y mysql-server nginx git curl ca-certificates
```

## 6. MySQL user

```bash
mysql
```
```sql
CREATE USER 'ecom'@'localhost' IDENTIFIED BY '<pick-a-strong-password>';
GRANT ALL PRIVILEGES ON branding_house.* TO 'ecom'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

## 7. Node.js 22

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node -v   # v22.x
```

## 8. Clone + .env

```bash
cd ~ && git clone git@github.com:Robert1owusu1/Kente_Market.git
cd Kente_Market/backend && npm ci --omit=dev
cp .env.example .env
```

Edit `.env` (use `nano .env`):
```ini
NODE_ENV=production
PORT=5000
TRUST_PROXY=1

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=ecom
DB_PASSWORD=<same as step 6>
DB_NAME=branding_house

JWT_SECRET=$(openssl rand -hex 64)
SESSION_SECRET=$(openssl rand -hex 64)

FRONTEND_URL=https://yourdomain.me
OAUTH_CALLBACK_URL=https://yourdomain.me

PAYSTACK_SECRET_KEY=sk_live_...
EMAIL_USER=kenterobert@gmail.com
EMAIL_PASSWORD=<gmail-app-password>
EMAIL_FROM=Bonwire Kente <noreply@yourdomain.me>

GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...

REPLICATE_API_TOKEN=r8_...
```

## 9. Create database schema + admin

```bash
npm run db:setup     # drops & recreates branding_house
npm run db:migrate   # applies pending migrations
npm run setup-admin  # creates first admin (prompts for email/password)
```

## 10. Build the frontend

```bash
cd ~/Kente_Market
# ensure frontend .env has VITE_API_URL= (empty) and VITE_PAYSTACK_PUBLIC_KEY=pk_live_...
npm ci && npm run build
mkdir -p /var/www/kente && cp -r dist/* /var/www/kente/
```

## 11. Systemd service

```bash
cat > /etc/systemd/system/kente-api.service << 'EOF'
[Unit]
Description=Kente Marketplace API
After=network.target mysql.service

[Service]
WorkingDirectory=/root/Kente_Market/backend
EnvironmentFile=/root/Kente_Market/backend/.env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload && systemctl enable --now kente-api
curl -s http://127.0.0.1:5000/health   # expect {"status":"OK"}
```

## 12. Nginx + HTTPS

```bash
cat > /etc/nginx/sites-available/kente << 'EOF'
server {
    listen 80;
    server_name yourdomain.me;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.me;

    ssl_certificate     /etc/letsencrypt/live/yourdomain.me/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.me/privkey.pem;

    root /var/www/kente;
    index index.html;
    client_max_body_size 8m;

    location / { try_files $uri $uri/ /index.html; }

    location /api/ {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location /uploads/ { proxy_pass http://127.0.0.1:5000; }
    location /images/  { proxy_pass http://127.0.0.1:5000; }

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
}
EOF

ln -sf /etc/nginx/sites-available/kente /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

apt install -y certbot python3-certbot-nginx
certbot --nginx -d yourdomain.me --non-interactive --agree-tos -m your@email.com
```

## 13. Google OAuth redirect URI

In Google Cloud Console → Credentials → OAuth client:
- Add **Authorized redirect URI**: `https://yourdomain.me/api/auth/google/callback`

## 14. Post-launch smoke test

1. `curl -s https://yourdomain.me/api/health` → `{"status":"OK"}`
2. Register a user → OTP email arrives
3. Login → Secure cookie set (check DevTools: `jwt`, `HttpOnly`, `Secure`)
4. Paystack test transaction → order goes to `processing`
5. Google sign-in works end-to-end
6. Images load at `/images/*.jpg`
7. `journalctl -u kente-api -f` → no missing-key warnings

## 15. Paystack go-live

Once smoke test passes with test keys:
- Swap `VITE_PAYSTACK_PUBLIC_KEY` → `pk_live_...`
- Swap `PAYSTACK_SECRET_KEY` → `sk_live_...`
- Rebuild frontend: `npm run build && cp -r dist/* /var/www/kente/`
- Set webhook URL in Paystack dashboard → `https://yourdomain.me/api/payments/webhook`
