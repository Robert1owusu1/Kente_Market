# Oracle Cloud "Always Free" ARM VM — setup for Kente Marketplace

Runs MySQL + Node (Express) + Nginx + Certbot on one always-on machine: $0/month forever.

---

## 1. Provision the instance (Oracle Console)

1. Sign in → **Compute > Instances > Create instance**.
2. Select the **Canonical Ubuntu 22.04 (minimal)** image (ARM works fine).
3. Under *Shape*, choose **`VM.Standard.A1.Flexible` (Ampere ARM)** and move **OCPUs to 4**, **RAM to 24 GB** (all Always Free).
4. Boot volume size: leave default (stays free).
5. **Add SSH key**: let Oracle generate one and *download it* (or paste your pubkey).
6. Create. Note the public IP.

### Open the firewall (Security List / Network Security Group)
Edit the VCN's security list → *Add Ingress Rules* for **TCP 22, 80, 443** from `0.0.0.0/0`.

> Oracle blocks outbound SMTP port 25, but you email via Gmail SMTP (465/587) which is unaffected.

SSH in: `ssh -i ~/Downloads/arm.key ubuntu@<PUBLIC_IP>`

---

## 2. Base packages

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y mysql-server nginx git curl ca-certificates ufw
sudo ufw allow 22,80,443/tcp && sudo ufw enable
```

## 3. MySQL user (for the app + setupDB, which drops/recreates the DB)

```bash
sudo mysql
```
```sql
CREATE USER 'ecom'@'localhost' IDENTIFIED BY '<strong-password>';
GRANT ALL PRIVILEGES ON branding_house.* TO 'ecom'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```
(Oracle's MySQL default already binds to 127.0.0.1 only, so the DB is not internet-visible.)

## 4. Node.js 22 (ARM build)

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # v22.x
```

## 5. Clone + configure

```bash
cd ~ && git clone git@github.com:Robert1owusu1/Kente_Market.git
cd Kente_Market/backend && npm ci --omit=dev
cp .env.example .env
nano .env    # DB_HOST=127.0.0.1  DB_USER=ecom  DB_PASSWORD=<same>  DB_NAME=branding_house
             # JWT_SECRET / SESSION_SECRET => openssl rand -hex 64
             # NODE_ENV=production  TRUST_PROXY=1  PORT=5000
             # FRONTEND_URL / OAUTH_CALLBACK_URL = https://yourdomain.com
             # PAYSTACK_SECRET_KEY=sk_live_...  EMAIL_*, GOOGLE_*, REPLICATE_*
```

## 6. Create the database schema + admin

```bash
npm run db:setup     # loads /repo/branding_house.sql  (drops & recreates branding_house)
npm run db:migrate   # applies migrateNewTables + migrateMarketplace (idempotent)
npm run setup-admin  # creates the first admin account
```

## 7. Build the React app + install it

```bash
cd ~/Kente_Market
# frontend .env:  VITE_API_URL= (empty, same-origin)  VITE_PAYSTACK_PUBLIC_KEY=pk_live_...
npm ci && npm run build
sudo cp -r dist/* /var/www/kente/
```

## 8. Systemd service — `/etc/systemd/system/kente-api.service`

```ini
[Unit]
Description=Kente Marketplace API
After=network.target mysql.service

[Service]
WorkingDirectory=/home/ubuntu/Kente_Market/backend
EnvironmentFile=/home/ubuntu/Kente_Market/backend/.env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload && sudo systemctl enable --now kente-api
curl -s http://127.0.0.1:5000/health   # {"status":"OK"}
```

## 9. Nginx — `/etc/nginx/sites-available/kente`

```nginx
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

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
```
```bash
sudo ln -s /etc/nginx/sites-available/kente /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com    # fills in the real cert paths
```

## 10. Post-launch smoke test

1. `/api/health` over HTTPS → 200
2. Register → OTP email arrives → verify
3. Login → cookie is HttpOnly + Secure + SameSite; admin panel accessible (setup-admin user)
4. Paystack **test key** transaction: create order → pay → `processing`, escrow held
5. Google sign-in; redirect URI registered as `https://yourdomain.com/api/auth/google/callback`
6. Uploads/images load (`/images/*.jpg`); `journalctl -u kente-api` shows no missing-key warnings

## 11. Cost recap
$0/mo. Oracle may reclaim the instance only if it stays idle/abandoned — a running marketplace is never idle.