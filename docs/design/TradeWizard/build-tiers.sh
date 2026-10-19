#!/bin/bash
# Build tier-specific page versions
PROJ="/home/balo/open-design-open-design-v0.7.0/.od/projects/bfcc3061-d27e-44dc-99f5-cc2514a4fb92"
PAGES="markets market-detail portfolio insights settings subscription"
cd "$PROJ"

mkdir -p free starter pro elite

python3 <<'PYTHON'
import re, os, sys

PROJ = "/home/balo/open-design-open-design-v0.7.0/.od/projects/bfcc3061-d27e-44dc-99f5-cc2514a4fb92"
PAGES = ["markets", "market-detail", "portfolio", "insights", "settings", "subscription"]
TIERS = ["free", "starter", "pro", "elite"]

CREDITS = {
    "free": ("3", "5", "3 credits"),
    "starter": ("38", "50", "38 credits"),
    "pro": ("47", "200", "47/200 credits"),
    "elite": ("∞", "∞", "∞ credits"),
}

def strip_tier_switcher(content):
    """Remove tier-switcher CSS block, JS block, and data-tier attribute."""
    # Remove <style id="tier-switcher-css">...</style>
    content = re.sub(r'<style id="tier-switcher-css">.*?</style>\n?', '', content, flags=re.DOTALL)
    # Remove the tier-switcher JS (starts with <script> containing const tiers=)
    content = re.sub(r'<script>\n?\(function\(\)\{\n?\s*const tiers=\[.*?</script>\n?', '', content, flags=re.DOTALL)
    # Remove data-tier attribute
    content = re.sub(r'\s*data-tier="[^"]*"', '', content)
    return content

def apply_tier(content, tier, page):
    """Apply tier-specific modifications."""

    # --- CREDIT BADGE ---
    cred_used, cred_total, cred_display = CREDITS[tier]
    content = re.sub(
        r'<span class="credit-text">[^<]*</span>',
        f'<span class="credit-text">{cred_display}</span>',
        content
    )
    # Also fix credit usage in insights sidebar
    if page == "insights":
        if tier == "free":
            content = re.sub(r'>47 / 200<', '>3 / 5<', content)
            content = re.sub(r'>153<', '>2<', content)
        elif tier == "starter":
            content = re.sub(r'>47 / 200<', '>38 / 50<', content)
            content = re.sub(r'>153<', '>12<', content)
        elif tier == "elite":
            content = re.sub(r'>47 / 200<', '>∞<', content)
            content = re.sub(r'>153<', '>∞<', content)

    # --- UPGRADE PROMPTS ---
    if tier == "free":
        # Show the general upgrade prompt
        content = re.sub(
            r'<div class="upgrade-prompt">\n',
            '<div class="upgrade-prompt" style="display:flex">\n',
            content
        )
        # Hide pro-specific prompt
        content = re.sub(
            r'<div class="upgrade-prompt-pro"',
            '<div class="upgrade-prompt-pro" style="display:none"',
            content
        )
    elif tier == "starter":
        # Hide general, show pro-specific
        content = re.sub(
            r'<div class="upgrade-prompt">\n',
            '<div class="upgrade-prompt" style="display:none">\n',
            content
        )
        content = re.sub(
            r'<div class="upgrade-prompt-pro"',
            '<div class="upgrade-prompt-pro" style="display:flex"',
            content
        )
    else:
        # Pro/Elite: hide all upgrade prompts
        content = re.sub(
            r'<div class="upgrade-prompt">\n',
            '<div class="upgrade-prompt" style="display:none">\n',
            content
        )
        content = re.sub(
            r'<div class="upgrade-prompt-pro"',
            '<div class="upgrade-prompt-pro" style="display:none"',
            content
        )

    # --- GATED ROW (market cards) ---
    if tier == "free":
        pass  # Keep as-is: shows "Upgrade to Starter+" link
    elif tier == "starter" or tier == "pro":
        content = content.replace(
            'Recurring analysis · <a href="subscription.html" class="upgrade-link">Upgrade to Starter+</a>',
            'Recurring analysis · 1 credit per run'
        )
    elif tier == "elite":
        content = content.replace(
            'Recurring analysis · <a href="subscription.html" class="upgrade-link">Upgrade to Starter+</a>',
            'Recurring analysis · included'
        )

    # --- INTERVAL CHIPS (market-detail only) ---
    if page == "market-detail":
        if tier == "free":
            # Disable all recurring intervals (1h, 4h, 12h, 1d)
            for interval in ["1h", "4h", "12h", "1d"]:
                content = content.replace(
                    f'<span class="interval-chip" data-i="{interval}">',
                    f'<span class="interval-chip" data-i="{interval}" style="opacity:.4;pointer-events:none">'
                )
                content = content.replace(
                    f'<span class="interval-chip active" data-i="{interval}">',
                    f'<span class="interval-chip" data-i="{interval}" style="opacity:.4;pointer-events:none">'
                )
        elif tier == "starter":
            # Disable 1h, 4h, 12h (only "once" and "1d" available)
            for interval in ["1h", "4h", "12h"]:
                content = content.replace(
                    f'<span class="interval-chip" data-i="{interval}">',
                    f'<span class="interval-chip" data-i="{interval}" style="opacity:.4;pointer-events:none">'
                )
                content = content.replace(
                    f'<span class="interval-chip active" data-i="{interval}">',
                    f'<span class="interval-chip" data-i="{interval}" style="opacity:.4;pointer-events:none">'
                )

    # --- PRIORITY / ELITE BADGES ---
    if page == "market-detail":
        if tier == "pro":
            content = content.replace(
                '<span class="priority-badge">',
                '<span class="priority-badge" style="display:inline-flex">'
            )
        elif tier == "elite":
            content = content.replace(
                '<span class="priority-badge">',
                '<span class="priority-badge" style="display:inline-flex">'
            )
            content = content.replace(
                '<span class="elite-badge">',
                '<span class="elite-badge" style="display:inline-flex">'
            )

    # --- SETTINGS: LOCKS ---
    if page == "settings":
        lock_html = '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:oklch(14% 0.015 260 / .75);border-radius:inherit;font-size:.75rem;color:oklch(97% 0.005 260);backdrop-filter:blur(2px);z-index:2">🔒 Upgrade to unlock</div>'
        lock_pro_html = '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:oklch(14% 0.015 260 / .75);border-radius:inherit;font-size:.75rem;color:oklch(97% 0.005 260);backdrop-filter:blur(2px);z-index:2">🔒 Pro+ required</div>'

        if tier == "free":
            # Lock email, push, webhook
            content = content.replace(
                '<div class="toggle-row email-toggle" style="position:relative">',
                '<div class="toggle-row email-toggle" style="position:relative">' + lock_html
            )
            content = content.replace(
                '<div class="toggle-row push-toggle" style="position:relative">',
                '<div class="toggle-row push-toggle" style="position:relative">' + lock_html
            )
            content = content.replace(
                '<div class="webhook-section" style="position:relative">',
                '<div class="webhook-section" style="position:relative">' + lock_html
            )
        elif tier == "starter":
            # Lock webhook only
            content = content.replace(
                '<div class="webhook-section" style="position:relative">',
                '<div class="webhook-section" style="position:relative">' + lock_pro_html
            )

    # --- INSIGHTS: FREE TIER LIMITS ---
    if page == "insights":
        if tier == "free":
            # Hide running card
            content = content.replace(
                '<div class="running-card">',
                '<div class="running-card" style="display:none">'
            )
            # Add CSS to limit analysis cards and truncate debate
            limit_css = """\n.analysis-card:nth-child(n+4){display:none}\n.debate-summary{position:relative;max-height:60px;overflow:hidden}\n.debate-summary::after{content:'';position:absolute;bottom:0;left:0;right:0;height:40px;background:linear-gradient(transparent,var(--surface));pointer-events:none}\n"""
            content = content.replace('</style>', limit_css + '</style>', 1)

    # --- PORTFOLIO: FREE TIER LIMITS ---
    if page == "portfolio":
        if tier == "free":
            limit_css = """\n.history-card:nth-child(n+3){display:none}\n.perf-section{position:relative;max-height:80px;overflow:hidden}\n.perf-section::after{content:'';position:absolute;bottom:0;left:0;right:0;height:60px;background:linear-gradient(transparent,var(--bg));pointer-events:none}\n"""
            content = content.replace('</style>', limit_css + '</style>', 1)

    # --- SUBSCRIPTION: CURRENT PLAN ---
    if page == "subscription":
        plan_names = {"free": "Free", "starter": "Starter", "pro": "Pro", "elite": "Elite"}
        current = plan_names[tier]
        content = re.sub(
            r'Current plan: <span class="plan-name">[^<]*</span>',
            f'Current plan: <span class="plan-name">{current}</span>',
            content
        )
        # Update credit status numbers
        if tier == "elite":
            content = re.sub(r'(<span class="big">)[^<]*(</span>)', r'\g<1>∞\g<2>', content, count=1)
        elif tier == "free":
            content = re.sub(r'(<span class="big">)[^<]*(</span>)', r'\g<1>3\g<2>', content, count=1)
        elif tier == "starter":
            content = re.sub(r'(<span class="big">)[^<]*(</span>)', r'\g<1>38\g<2>', content, count=1)

    # --- REMOVE PM NAV FOR FREE/STARTER; SIMPLIFY WALLET BADGE ---
    if tier in ("free", "starter"):
        content = re.sub(r'\s*<a href="portfolio-manager\.html">PM</a>', '', content)
        # Replace full wallet-badge (with committed/available breakdown) with simple balance-only badge
        content = re.sub(
            r'<span class="wallet-badge">.*?</span>(?=\s*<span class="credit-badge">)',
            '<span class="wallet-badge"><span class="wallet-text">$1,240</span></span>',
            content, flags=re.DOTALL
        )
        # Remove hover detail CSS (no popover needed)
        content = re.sub(r'\.wallet-sub\{[^}]*\}\n?', '', content)
        content = re.sub(r'\.wallet-detail\{[^}]*\}\n?', '', content)
        content = re.sub(r'\.wallet-badge:hover[^{]*\{[^}]*\}\n?', '', content)
        content = re.sub(r'\.wd-row\{[^}]*\}\n?', '', content)
        content = re.sub(r'\.wd-lbl\{[^}]*\}\n?', '', content)
        content = re.sub(r'\.wd-val\{[^}]*\}\n?', '', content)
        content = re.sub(r'\.wd-avail[^{]*\{[^}]*\}\n?', '', content)

    # --- FIX NAV LINKS ---
    # landing.html and auth.html need to go up one level
    content = content.replace('href="landing.html"', 'href="../landing.html"')
    content = content.replace('href="auth.html"', 'href="../auth.html"')
    # index.html link goes up one level
    content = content.replace('href="index.html"', 'href="../index.html"')

    return content

# Process each page for each tier
for page in PAGES:
    src = os.path.join(PROJ, f"{page}.html")
    if not os.path.exists(src):
        print(f"SKIP: {src}")
        continue

    with open(src, 'r') as f:
        raw = f.read()

    base = strip_tier_switcher(raw)

    for tier in TIERS:
        out_path = os.path.join(PROJ, tier, f"{page}.html")
        result = apply_tier(base, tier, page)
        with open(out_path, 'w') as f:
            f.write(result)
        print(f"  {tier}/{page}.html")

print("\nDone!")
PYTHON
