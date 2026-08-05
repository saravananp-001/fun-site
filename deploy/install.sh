#!/usr/bin/env bash
#
# One-shot installer for the birthday treat site.
# Run it FROM the project directory, as root:
#
#   sudo bash deploy/install.sh
#
# Safe to re-run — it's idempotent and will just update an existing install.

set -euo pipefail

APP_DIR=/opt/treat
DATA_DIR=/var/lib/treat
SVC_USER=treat
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

say() { printf '\n\033[1;35m==>\033[0m %s\n' "$1"; }
die() { printf '\n\033[1;31mError:\033[0m %s\n' "$1" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run this with sudo."
[[ -f "$SRC/server.js" ]] || die "Run this from the project directory (server.js not found)."

# ---------------------------------------------------------------- node
say "Checking Node.js"
command -v node >/dev/null 2>&1 || die "Node.js is not installed. Install Node 22+ first:
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs"

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
echo "    node $(node -v)"
if (( NODE_MAJOR < 22 )); then
  echo "    ! Node < 22 — SQLite will be unavailable, falling back to JSON files."
  echo "      That still works, but Node 22+ is recommended."
fi

# ---------------------------------------------------------------- user
say "Creating service user '$SVC_USER'"
if id "$SVC_USER" >/dev/null 2>&1; then
  echo "    already exists"
else
  useradd --system --no-create-home --shell /usr/sbin/nologin "$SVC_USER"
  echo "    created"
fi

# ---------------------------------------------------------------- files
say "Installing app to $APP_DIR"
mkdir -p "$APP_DIR"
# Copy everything except local junk and the dev database.
tar -C "$SRC" \
    --exclude='.git' --exclude='node_modules' --exclude='data' \
    --exclude='*.log' --exclude='.DS_Store' \
    -cf - . | tar -C "$APP_DIR" -xf -

say "Installing dependencies"
( cd "$APP_DIR" && npm install --omit=dev --no-audit --no-fund )

say "Preparing data directory $DATA_DIR"
mkdir -p "$DATA_DIR"
chown -R "$SVC_USER:$SVC_USER" "$DATA_DIR"
chmod 750 "$DATA_DIR"
chown -R root:root "$APP_DIR"        # app code stays read-only to the service
echo "    ok"

# ---------------------------------------------------------------- systemd
say "Installing systemd service"
install -m 644 "$SRC/deploy/treat.service" /etc/systemd/system/treat.service
systemctl daemon-reload
systemctl enable treat >/dev/null
systemctl restart treat
sleep 2

if systemctl is-active --quiet treat; then
  echo "    treat.service is running"
else
  journalctl -u treat -n 30 --no-pager || true
  die "treat.service failed to start (log above)."
fi

# ---------------------------------------------------------------- nginx
if command -v nginx >/dev/null 2>&1; then
  say "Configuring nginx"
  if [[ -d /etc/nginx/sites-available ]]; then
    install -m 644 "$SRC/deploy/nginx-treat.conf" /etc/nginx/sites-available/treat
    ln -sf /etc/nginx/sites-available/treat /etc/nginx/sites-enabled/treat
    rm -f /etc/nginx/sites-enabled/default
  else
    install -m 644 "$SRC/deploy/nginx-treat.conf" /etc/nginx/conf.d/treat.conf
    # default_server may already be claimed by the stock config
    sed -i 's/ default_server//g' /etc/nginx/conf.d/treat.conf
  fi
  nginx -t
  systemctl reload nginx
  echo "    nginx reloaded"
else
  say "nginx not installed — skipping"
  echo "    Install it with:  apt-get install -y nginx   (then re-run this script)"
  echo "    Or expose Node directly by setting HOST=0.0.0.0 in the service file."
fi

# ---------------------------------------------------------------- firewall
say "Firewall"
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null && echo "    opened port 80 (ufw)"
else
  echo "    no active ufw — make sure port 80 is open in your provider's firewall"
fi

# ---------------------------------------------------------------- done
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
KEY=$(grep -oP '(?<=^Environment=ADMIN_KEY=).*' /etc/systemd/system/treat.service || echo '')

cat <<EOF

  Done.

  Site        http://${IP:-YOUR_SERVER_IP}/
  Dashboard   http://${IP:-YOUR_SERVER_IP}/admin?key=${KEY}
  Database    $DATA_DIR/responses.db

  Logs        journalctl -u treat -f
  Restart     systemctl restart treat
  Update      re-run this script after pulling changes

  Before sharing the link, change ADMIN_KEY in
  /etc/systemd/system/treat.service, then:
      systemctl daemon-reload && systemctl restart treat

EOF
