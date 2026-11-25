# Payout screens

How people set up a payout account, withdraw, and how the team approves and controls payouts.
Database side: `supabase/migrations/20261123000100_payout_controls.sql`. Code: `lib/payouts/`, `components/payouts/`.

## Pages

| Who | Page | Shows |
| --- | --- | --- |
| Affiliate | `/payout-details` | Payout account, automatic payout switch |
| Affiliate | `/withdrawals` | Balances, withdraw form with live preview, history |
| Merchant | `/payout-details` | Same account panel, then the withdraw form and history below it (the merchant navigation has no Withdrawals entry) |
| Admin | `/withdrawals` | Queue tabs: Needs approval, Approved and processing, Paid, Failed or rejected |
| Admin | `/settings` | Payout settings, and `?tab=blackout` for blackout dates |

## Flows

**Add or change the payout account.** Choose bank, type the 10 digit number, "Check account". The bank returns the account name; the person confirms it. If it does not match the profile name, saving is refused with: "The name on this account does not match the name on your Affilova profile. Update your profile name or use an account in your own name." Then "Email me a code", enter the 6 digit code, "Save account". Only the bank name, last four digits and account name are ever shown afterwards. A change freezes withdrawals for 72 hours; the screen shows the end time in Lagos time.

**Withdraw.** Type an amount in naira. The server previews gross, fee and net on every change and lists every blocked rule in plain words. Allowed: "Email me a code", enter it, "Request withdrawal". The code is checked only after the rules pass, so a blocked request never uses up a code. Results: "Requested", "Approved and queued", or "Waiting for admin approval". A requested withdrawal can be cancelled by its owner; the money returns to the balance.

**Step-up codes.** 6 digits, HMAC-SHA256 hashed with `STEP_UP_SECRET` (at least 32 characters), valid 10 minutes, single use, 60 second cooldown, at most 5 codes per hour per purpose, at most 5 wrong tries per code.

**Automatic payout.** Runs Monday to Friday except blackout days, at or above the minimum, with the withdrawal fee. The screen states the next payout day and any blackout reason.

## Rules shown to people

Minimum withdrawal, fee percent with minimum and cap, commission hold days, the 72 hour freeze, Monday to Friday payouts and blackout days. All come from the database (`get_payout_screen_data`), never from constants in the page.

## Admin controls

- **Queue.** Amount, fee, net, kind, requested time, bank name, last four digits, account name, whether it is the user's first withdrawal, risk flag, approvals so far ("needs a second approver"). Approve, or Reject with a reason of at least 10 characters. A person cannot act on their own withdrawal (screen and database both refuse). Needs `payouts:approve`.
- **Payout settings.** Whitelisted keys only, ranges enforced in the database, one confirmation listing what changes, history from `settings_history`. Needs `settings:write`. `platform_fee_bps` affects future orders only.
- **Blackout dates.** Add a date with a reason, remove with confirmation. Weekends are always blocked and need no entry. Needs `settings:write`.

## Emails

Step-up code email, and one withdrawal notice when a withdrawal becomes paid, failed, reversed or rejected (job `withdrawal_notice`, claimed once per withdrawal and status in `email_log`). Notices hold amount, fee, net and status, never an account number. Queued from the Paystack webhook, the reconciler and the reject action.

## Support runbook: "my payout did not arrive"

1. Find the withdrawal in Admin, Withdrawals (tab by status). Note status, requested time, bank name and last four digits.
2. **Needs approval:** it is waiting for an approver. Approve or reject it; the user is told either way.
3. **Approved and processing:** it is queued for the next payout run (Monday to Friday, not on a blackout day) or sent and waiting for the bank. Check Settings, Blackout dates for a pause. The reconciler settles stuck transfers.
4. **Paid:** Paystack sent it. Ask the user to check the account ending in the last four digits and the bank's own delay; ask them to confirm those digits.
5. **Failed, reversed or rejected:** the full amount is back in their available balance and they were emailed. Check the reason. If the account details were wrong, they change the account (72 hour freeze applies).
6. **Account recently changed:** withdrawals are frozen 72 hours after a change.
7. Never ask for, or write down, a full account number or a step-up code.
