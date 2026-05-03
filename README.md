# Insighta CLI

Command-line interface for Insighta Labs+.

---

## Installation

### Option 1 — Install from GitHub
npm install -g github:bigoluwagentle/insighta-cli

### Option 2 — Clone and link
git clone https://github.com/bigoluwagentle/insighta-cli.git
cd insighta-cli
npm install
npm link

Then run from anywhere:
insighta login
```

## Configuration

The CLI talks to the live backend by default. To use a different backend:
```bash
export INSIGHTA_API_URL=https://your-backend.railway.app
```

---

## Commands

### Auth
```bash
insighta login          # Opens GitHub OAuth in browser, saves tokens
insighta logout         # Clears local credentials and revokes session
insighta whoami         # Shows current logged-in user
```

### Profiles
```bash
# List profiles
insighta profiles list
insighta profiles list --gender male
insighta profiles list --country NG --age-group adult
insighta profiles list --min-age 25 --max-age 40
insighta profiles list --sort-by age --order desc
insighta profiles list --page 2 --limit 20

# Get a single profile
insighta profiles get <id>

# Natural language search
insighta profiles search "young males from nigeria"
insighta profiles search "female seniors" --page 2

# Create a profile (admin only)
insighta profiles create --name "Harriet Tubman"

# Export CSV
insighta profiles export --format csv
insighta profiles export --format csv --gender male --country NG
```

---

## Token Handling

- Tokens are stored at `~/.insighta/credentials.json`
- Access tokens expire in 3 minutes — the CLI auto-refreshes using the refresh token
- If the refresh token is also expired, you are prompted to run `insighta login` again
- Credentials are cleared on logout

---

## Configuration

Set `INSIGHTA_API_URL` to point to a different backend:
```bash
export INSIGHTA_API_URL=https://your-backend.railway.app
```
