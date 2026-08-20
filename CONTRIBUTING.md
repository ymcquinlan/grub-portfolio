# Contributing / Sanitization checklist

This repo is public. Before committing anything, check every new or changed file for:

- API keys, tokens, passwords, private keys
- `.env` files or hardcoded secrets in code
- Internal URLs (company Notion/Slack/Drive links, internal hostnames)
- Company or client names that aren't meant to be public (replace with generic examples,
  e.g. "Acme Corp" instead of a real client)
- Personal data (emails, phone numbers) that isn't yours to publish
- Internal tool/system names specific to a single employer's stack — generalize the
  example so it's reusable by anyone

## Before every push

Run a secrets scanner. Two easy options:

```bash
# gitleaks (recommended, fast, no signup)
brew install gitleaks   # or: go install github.com/gitleaks/gitleaks/v8@latest
gitleaks detect --source . -v

# or trufflehog
pip install trufflehog3 --break-system-packages
trufflehog3 .
```

Fix or remove anything flagged before pushing. Don't `git commit --amend` your way around
history if a secret already got committed — rotate the credential and consider the repo's
history compromised for that secret; scrub with `git filter-repo` or BFG if needed.

## New entry checklist

- [ ] README explains what it does and how to use/install it
- [ ] No hardcoded credentials — required env vars documented, not filled in
- [ ] No internal/company-specific references left in
- [ ] LICENSE applies (or override noted)
- [ ] Ran a secrets scan
