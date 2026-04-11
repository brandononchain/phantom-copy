#!/usr/bin/env python3
"""
PhantomCopy Invoice Generator v3
Matched to dashboard UI. No decorative shapes.
"""

from reportlab.lib.pagesizes import letter
from reportlab.lib.colors import HexColor, Color
from reportlab.pdfgen import canvas
import datetime

# ── Dashboard-matched palette ─────────────────────────────────────────────────
BG       = HexColor("#050508")
CARD     = HexColor("#0D0D14")
CARD_ALT = HexColor("#0A0A10")
BORDER   = HexColor("#1C1C28")
T1       = HexColor("#EBEBF0")   # rgba(255,255,255,0.92)
T2       = HexColor("#808090")   # rgba(255,255,255,0.5)
T3       = HexColor("#484858")   # rgba(255,255,255,0.28)
ACCENT   = HexColor("#6366F1")
GREEN    = HexColor("#00E5A0")
GREEN_BG = HexColor("#0A2E1E")
WHITE    = HexColor("#FFFFFF")


def hline(c, x1, x2, y, color=BORDER, w=0.3):
    c.setStrokeColor(color); c.setLineWidth(w); c.line(x1, y, x2, y)


def rect(c, x, y, w, h, fill=None, stroke=None, r=0, sw=0.3):
    if r > 0:
        p = c.beginPath()
        p.moveTo(x+r,y); p.lineTo(x+w-r,y); p.arcTo(x+w-r,y,x+w,y+r,r)
        p.lineTo(x+w,y+h-r); p.arcTo(x+w,y+h-r,x+w-r,y+h,r)
        p.lineTo(x+r,y+h); p.arcTo(x+r,y+h,x,y+h-r,r)
        p.lineTo(x,y+r); p.arcTo(x,y+r,x+r,y,r); p.close()
        if fill: c.setFillColor(fill)
        if stroke: c.setStrokeColor(stroke); c.setLineWidth(sw)
        c.drawPath(p, fill=1 if fill else 0, stroke=1 if stroke else 0)
    else:
        if fill: c.setFillColor(fill)
        if stroke: c.setStrokeColor(stroke); c.setLineWidth(sw)
        c.rect(x, y, w, h, fill=1 if fill else 0, stroke=1 if stroke else 0)


def accent_line(c, x1, x2, y):
    c.setStrokeColor(ACCENT); c.setLineWidth(0.6); c.line(x1, y, x2, y)


def generate_invoice(
    invoice_id="INV-0047", invoice_date="April 1, 2026", due_date="April 1, 2026",
    billing_period="Apr 1 - May 1, 2026",
    customer_name="Brandon", customer_email="brandon@lobstack.ai", customer_company="",
    plan_name="Pro", plan_price=69.00,
    line_items=None, subtotal=None, tax_rate=0.0, tax_amount=0.0,
    proration_credit=0.0, total=None,
    payment_method="Visa ending 4242", payment_status="Paid",
    payment_date="April 1, 2026",
    stripe_charge_id="ch_3PqR7x2eZvKYlo2C1a2b3c4d",
    output_path="/home/claude/invoice.pdf",
):
    if line_items is None:
        line_items = [{"description": f"PhantomCopy {plan_name} Plan", "period": billing_period, "qty": 1, "unit_price": plan_price, "amount": plan_price}]
    if subtotal is None:
        subtotal = sum(i["amount"] for i in line_items)
    if total is None:
        total = subtotal + tax_amount - proration_credit

    W, H = letter
    c = canvas.Canvas(output_path, pagesize=letter)
    c.setTitle(f"PhantomCopy Invoice {invoice_id}")
    M = 54
    RW = W - M * 2
    Y = H

    # ── BG ────────────────────────────────────────────────────────────────
    c.setFillColor(BG); c.rect(0, 0, W, H, fill=1, stroke=0)

    # ── Top accent (thin 2px line, indigo only, no gradient) ──────────────
    c.setFillColor(ACCENT); c.rect(0, H - 2, W, 2, fill=1, stroke=0)

    # ── Header ────────────────────────────────────────────────────────────
    Y -= 52

    # Logo: just the brand text, no icon shape
    c.setFillColor(T1); c.setFont("Helvetica-Bold", 20)
    c.drawString(M, Y, "PhantomCopy")
    c.setFillColor(T3); c.setFont("Helvetica", 7.5)
    c.drawString(M, Y - 14, "The Stealth Standard for Modern Prop Trading")

    # Right: invoice ID
    c.setFillColor(T3); c.setFont("Helvetica", 7.5)
    c.drawRightString(W - M, Y + 2, "INVOICE")
    c.setFillColor(T1); c.setFont("Courier-Bold", 15)
    c.drawRightString(W - M, Y - 14, invoice_id)

    # ── Separator ─────────────────────────────────────────────────────────
    Y -= 32
    hline(c, M, W - M, Y)

    # ── Meta: Date / Due / Status ─────────────────────────────────────────
    Y -= 30
    cols = [("DATE ISSUED", invoice_date), ("DUE DATE", due_date), ("STATUS", payment_status)]
    cw = RW / 3
    for i, (lab, val) in enumerate(cols):
        x = M + cw * i
        c.setFillColor(T3); c.setFont("Helvetica", 6.5); c.drawString(x, Y + 8, lab)
        if lab == "STATUS" and val.lower() == "paid":
            rect(c, x, Y - 8, 34, 14, fill=GREEN_BG, r=0)
            c.setFillColor(GREEN); c.setFont("Helvetica-Bold", 7.5); c.drawString(x + 7, Y - 4, "PAID")
        else:
            c.setFillColor(T1); c.setFont("Helvetica-Bold", 10); c.drawString(x, Y - 6, val)

    # ── From / To ─────────────────────────────────────────────────────────
    Y -= 38
    hw = (RW - 16) / 2
    bh = 46

    # From
    rect(c, M, Y - bh, hw, bh, fill=CARD, stroke=BORDER, r=0, sw=0.3)
    c.setFillColor(T3); c.setFont("Helvetica", 6.5); c.drawString(M + 12, Y - 12, "FROM")
    c.setFillColor(T1); c.setFont("Helvetica-Bold", 10); c.drawString(M + 12, Y - 26, "PhantomCopy, Inc.")
    c.setFillColor(T2); c.setFont("Helvetica", 8); c.drawString(M + 12, Y - 38, "billing@phantomcopy.com")

    # To
    tx = M + hw + 16
    rect(c, tx, Y - bh, hw, bh, fill=CARD, stroke=BORDER, r=0, sw=0.3)
    c.setFillColor(T3); c.setFont("Helvetica", 6.5); c.drawString(tx + 12, Y - 12, "BILL TO")
    c.setFillColor(T1); c.setFont("Helvetica-Bold", 10)
    bill_name = customer_name + (f"  |  {customer_company}" if customer_company else "")
    c.drawString(tx + 12, Y - 26, bill_name)
    c.setFillColor(T2); c.setFont("Helvetica", 8); c.drawString(tx + 12, Y - 38, customer_email)

    # ── Line Items ────────────────────────────────────────────────────────
    Y -= bh + 24

    # Column positions
    dx = M + 12; px = M + 280; qx = M + 382; ux = M + 418; ax = W - M - 12

    # Header row
    rect(c, M, Y - 1, RW, 16, fill=CARD, r=0)
    c.setFillColor(T3); c.setFont("Helvetica-Bold", 6.5)
    c.drawString(dx, Y + 3, "DESCRIPTION"); c.drawString(px, Y + 3, "PERIOD")
    c.drawString(qx, Y + 3, "QTY"); c.drawString(ux, Y + 3, "UNIT PRICE"); c.drawRightString(ax, Y + 3, "AMOUNT")

    # Rows
    for idx, item in enumerate(line_items):
        Y -= 24
        if idx % 2 == 0:
            rect(c, M, Y - 1, RW, 20, fill=CARD_ALT, r=0)
        c.setFillColor(T1); c.setFont("Helvetica", 9); c.drawString(dx, Y + 4, item["description"])
        c.setFillColor(T2); c.setFont("Helvetica", 8); c.drawString(px, Y + 4, item.get("period", ""))
        c.setFillColor(T2); c.setFont("Helvetica", 9); c.drawString(qx, Y + 4, str(item["qty"]))
        c.setFillColor(T2); c.setFont("Courier", 8.5); c.drawString(ux, Y + 4, f"${item['unit_price']:.2f}")
        c.setFillColor(T1); c.setFont("Courier-Bold", 9); c.drawRightString(ax, Y + 4, f"${item['amount']:.2f}")

    # ── Separator ─────────────────────────────────────────────────────────
    Y -= 20
    hline(c, M, W - M, Y)

    # ── Two columns: Summary (left) + Totals (right) ─────────────────────
    Y -= 20
    totals_x = M + RW * 0.56

    # Left: Plan / Period / Renewal
    c.setFillColor(T3); c.setFont("Helvetica", 6.5)
    c.drawString(M, Y, "PLAN"); c.drawString(M + 100, Y, "BILLING PERIOD"); c.drawString(M + 230, Y, "RENEWAL")
    c.setFillColor(T2); c.setFont("Helvetica", 8.5)
    c.drawString(M, Y - 13, f"PhantomCopy {plan_name}")
    c.drawString(M + 100, Y - 13, billing_period)
    c.drawString(M + 230, Y - 13, "Auto-renew")

    # Right: Totals
    ty = Y + 2
    rows = [("Subtotal", f"${subtotal:.2f}", T2)]
    if proration_credit > 0:
        rows.append(("Proration Credit", f"-${proration_credit:.2f}", GREEN))
    if tax_amount > 0:
        rows.append((f"Tax ({tax_rate*100:.1f}%)", f"${tax_amount:.2f}", T2))

    for lab, val, col in rows:
        c.setFillColor(T3); c.setFont("Helvetica", 8.5); c.drawString(totals_x, ty, lab)
        c.setFillColor(col); c.setFont("Courier", 9.5); c.drawRightString(W - M, ty, val)
        ty -= 20

    # Total Due
    ty -= 4
    accent_line(c, totals_x, W - M, ty + 14)
    c.setFillColor(T3); c.setFont("Helvetica", 8); c.drawString(totals_x, ty, "Total Due")
    c.setFillColor(T1); c.setFont("Courier-Bold", 16); c.drawRightString(W - M, ty - 2, f"${total:.2f}")

    bottom = ty - 22

    # ── Payment Details ───────────────────────────────────────────────────
    pay_h = 52
    pay_top = bottom - 16
    rect(c, M, pay_top - pay_h, RW, pay_h, fill=CARD, stroke=BORDER, r=0, sw=0.3)

    py = pay_top - 12
    c.setFillColor(T3); c.setFont("Helvetica-Bold", 6.5); c.drawString(M + 12, py, "PAYMENT DETAILS")

    py -= 16
    pcols = [("METHOD", payment_method, False), ("DATE", payment_date, False), ("STRIPE ID", stripe_charge_id, True)]
    pcw = (RW - 50) / 3
    for i, (lab, val, mono) in enumerate(pcols):
        ppx = M + 12 + pcw * i
        c.setFillColor(T3); c.setFont("Helvetica", 6.5); c.drawString(ppx, py, lab)
        c.setFillColor(T2 if mono else T1); c.setFont("Courier" if mono else "Helvetica", 8)
        c.drawString(ppx, py - 12, val[:28] + "..." if len(val) > 30 else val)

    c.setFillColor(T3); c.setFont("Helvetica", 6); c.drawString(M + 12, pay_top - pay_h + 6, "Processed by Stripe")

    # Check icon (simple, no circle)
    cx = W - M - 16; cy = pay_top - pay_h / 2
    c.setStrokeColor(GREEN); c.setLineWidth(1.2); c.setLineCap(1)
    p = c.beginPath(); p.moveTo(cx - 6, cy - 1); p.lineTo(cx - 2, cy - 5); p.lineTo(cx + 6, cy + 5)
    c.drawPath(p, fill=0, stroke=1)

    # ── Footer ────────────────────────────────────────────────────────────
    fy = 38
    hline(c, M, W - M, fy + 18, color=BORDER, w=0.3)

    c.setFillColor(T3); c.setFont("Helvetica", 6.5)
    c.drawString(M, fy + 4, "PhantomCopy, Inc.  |  The Stealth Standard for Modern Prop Trading")
    c.drawString(M, fy - 6, "billing@phantomcopy.com")
    c.setFont("Courier", 6.5)
    c.drawRightString(W - M, fy + 4, invoice_id)
    c.drawRightString(W - M, fy - 6, datetime.datetime.now().strftime("%b %d, %Y %H:%M UTC"))

    c.save()
    return output_path


# ─── Generate ─────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    out = "/mnt/user-data/outputs"

    generate_invoice(
        invoice_id="INV-0047", invoice_date="April 1, 2026", due_date="April 1, 2026",
        billing_period="Apr 1 - May 1, 2026", customer_name="Brandon",
        customer_email="brandon@lobstack.ai", plan_name="Pro", plan_price=69.00,
        subtotal=69.00, total=69.00, payment_date="April 1, 2026",
        stripe_charge_id="ch_3PqR7x2eZvKYlo2C1a2b3c4d",
        output_path=f"{out}/invoice-INV-0047.pdf",
    )

    generate_invoice(
        invoice_id="INV-0048", invoice_date="April 11, 2026", due_date="April 11, 2026",
        billing_period="Apr 11 - May 1, 2026", customer_name="Brandon",
        customer_email="brandon@lobstack.ai", plan_name="Pro+", plan_price=89.00,
        line_items=[
            {"description": "PhantomCopy Pro+ Plan (prorated)", "period": "Apr 11 - May 1, 2026", "qty": 1, "unit_price": 89.00, "amount": 59.33},
            {"description": "Credit: Pro Plan (unused)", "period": "Apr 11 - May 1, 2026", "qty": 1, "unit_price": -46.00, "amount": -46.00},
        ],
        subtotal=59.33, proration_credit=46.00, total=13.33,
        payment_date="April 11, 2026", stripe_charge_id="ch_5TrS9y4gBvMZnp4E2c3d4e5f",
        output_path=f"{out}/invoice-INV-0048-upgrade.pdf",
    )

    generate_invoice(
        invoice_id="INV-0042", invoice_date="March 1, 2026", due_date="March 1, 2026",
        billing_period="Mar 1 - Apr 1, 2026", customer_name="Brandon",
        customer_email="brandon@lobstack.ai", plan_name="Pro", plan_price=69.00,
        line_items=[
            {"description": "PhantomCopy Pro Plan", "period": "Mar 1 - Apr 1, 2026", "qty": 1, "unit_price": 69.00, "amount": 69.00},
            {"description": "Additional Proxy Pool (EU-West)", "period": "Mar 1 - Apr 1, 2026", "qty": 1, "unit_price": 12.00, "amount": 12.00},
        ],
        subtotal=81.00, tax_rate=0.1025, tax_amount=8.30, total=89.30,
        payment_date="March 1, 2026", stripe_charge_id="ch_2OpQ6w1dAvLXmn3D1b2c3d4e",
        output_path=f"{out}/invoice-INV-0042-with-tax.pdf",
    )

    print("Done. 3 invoices generated.")
