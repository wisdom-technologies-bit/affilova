# Account and Merchant Screens Documentation

## Overview
This document outlines the architecture, data sources, privacy rules, and metric definitions for the customer account and merchant dashboard screens in Affilova.

---

## Customer Account App (`/hosts/account`)

### 1. Purchases (`/`)
- **Data Source:** `account_orders` SQL function (preceded by `claim_guest_orders`).
- **Features:** Lists all buyer purchases, payment status badges, dates, totals formatted in Naira, and direct actions to view details or download files. Includes an honest empty state ("You have not bought anything yet.").

### 2. Purchase Detail (`/purchases/[orderId]`)
- **Data Source:** `account_order_detail` SQL function.
- **Features:** Summary of the order, list of purchased files with display name, size, download counts, and malware scan state. Files that are not clean show "Unavailable while we check it" without download buttons. Includes refund request submission and refund window tracking.

### 3. Receipts (`/receipts` & `/receipts/[orderId]`)
- **Data Source:** `account_order_detail` SQL function.
- **Features:** Printable tax & payment receipt showing order number, Lagos-localized date, vendor business name, product details, tax lines, payment channel, Affilova platform attribution, legal identity notice, and a Print button with a dedicated print stylesheet.

### 4. Support (`/support`)
- **Features:** Guidance on getting help with customer purchases, including a direct link to the support contact page.

### 5. Profile (`/profile`)
- **Data Source:** User session and profile data.
- **Features:** Read-only email address, updateable display name, sign-out action, and information regarding account deletion and data export requests.

---

## Merchant Dashboard App (`/hosts/merchant`)

### Privacy Rule (Crucial)
**Vendors never see buyer identity.** Customer personal information (such as buyer name, email address, and IP addresses) is strictly redacted from all merchant views, sales lists, and analytics queries. Merchants only see order numbers, product titles, amounts, and whether a sale was driven via an affiliate.

### 1. Overview (`/`)
- **Data Source:** `vendor_overview`, `vendor_daily_series`, and `vendor_top_products`.
- **Features:** Date range presets, KPI cards (Orders, Gross Sales, Vendor Net Earnings, Refunds & Refund Rate, Pending Balance, Available Balance), daily sales chart & table, top products, and a payout status notice ("Withdrawals are not available yet").

### 2. Sales (`/sales`)
- **Data Source:** `vendor_sales_list` and `vendor_refund_requests`.
- **Features:** Tabs for All, Paid, Refunded, and Disputed orders with "via affiliate" indicators. Refund requests tab features inline Approve and Reject dialogs (with mandatory 10+ character rejection notes).

### 3. Analytics (`/analytics`)
- **Data Source:** `vendor_overview`, `vendor_daily_series`, and `vendor_top_products`.
- **Features:** Detailed date-filtered metrics, daily performance trends, top-performing products, and affiliate sales share calculation (orders via affiliate divided by total orders).

---

## Metric Definitions
- **Gross Sales:** Total amount paid by buyers in NGN kobo before fees and commissions.
- **Vendor Net Earnings:** Amount credited to the vendor after platform fees and affiliate commissions.
- **Platform Fee:** Percentage fee retained by Affilova.
- **Affiliate Commission:** Payout distributed to promoting affiliates.
- **Refund Rate (bps):** Basis points of refunded orders relative to total paid orders (100 bps = 1%).
- **Affiliate Share of Sales:** Percentage of orders attributed to affiliate links.
