# ERP System (Node.js + SQLite)

Production-friendly guide for Ubuntu 22.04 Server.

## 1. Requirements

- Ubuntu 22.04 Server
- SSH access with sudo
- Domain name (optional, recommended for HTTPS)

## 2. Install system packages

```bash
sudo apt update
sudo apt install -y curl git build-essential ca-certificates gnupg
```

## 3. Install Node.js 20 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

node -v
npm -v
```

Expected: Node 20.x and npm available.

## 4. Clone project and install dependencies

```bash
cd /opt
sudo git clone git@github.com:Ddoshop/erp-system.git
sudo chown -R $USER:$USER /opt/erp-system
cd /opt/erp-system

npm install
```

## 5. Environment configuration

Create `.env` from template:

```bash
cp .env.example .env
nano .env
```

Minimum required values:

- `PORT=3000`
- `JWT_SECRET=<strong-random-secret>`

Optional mail settings for reminders:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`
- `REMINDER_DAYS`

Generate secure JWT secret:

```bash
openssl rand -base64 48
```

## 6. First run (manual check)

```bash
npm start
```

In another shell:

```bash
curl -I http://127.0.0.1:3000/login
```

Expected HTTP status: `200` or `302`.

Stop with `Ctrl+C` after check.

## 7. Run as a service (systemd)

Create service file:

```bash
sudo nano /etc/systemd/system/erp.service
```

Put this content:

```ini
[Unit]
Description=ERP System Node.js service
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/opt/erp-system
Environment=NODE_ENV=production
EnvironmentFile=/opt/erp-system/.env
ExecStart=/usr/bin/node /opt/erp-system/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Set permissions:

```bash
sudo chown -R www-data:www-data /opt/erp-system
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable erp
sudo systemctl start erp
sudo systemctl status erp --no-pager
```

Logs:

```bash
journalctl -u erp -f
```

## 8. Nginx reverse proxy (recommended)

Install Nginx:

```bash
sudo apt install -y nginx
```

Create site config:

```bash
sudo nano /etc/nginx/sites-available/erp
```

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable config:

```bash
sudo ln -s /etc/nginx/sites-available/erp /etc/nginx/sites-enabled/erp
sudo nginx -t
sudo systemctl reload nginx
```

## 9. Enable HTTPS (Let's Encrypt)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

## 10. Firewall (UFW)

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

## 11. Update process (deploy new commits)

```bash
cd /opt/erp-system
git pull
npm install
sudo systemctl restart erp
sudo systemctl status erp --no-pager
```

## 12. Backup SQLite data

Project stores runtime data under `data/`.

Quick backup:

```bash
cd /opt/erp-system
mkdir -p backups
tar -czf backups/erp-data-$(date +%F-%H%M).tar.gz data
```

## 13. Troubleshooting

Service status:

```bash
sudo systemctl status erp --no-pager
```

Live logs:

```bash
journalctl -u erp -f
```

Port check:

```bash
sudo ss -tulpen | grep 3000
```

Nginx check:

```bash
sudo nginx -t
sudo systemctl status nginx --no-pager
```

If service fails after dependency changes:

```bash
cd /opt/erp-system
rm -rf node_modules package-lock.json
npm install
sudo systemctl restart erp
```
