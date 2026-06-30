/* ============================================================
   Mock data — fallback used when the live latest-invoice endpoint
   is unreachable (e.g. offline / static hosting with no backend).
   Exposed on window.
   ============================================================ */

window.MOCK_INVOICES = [
  {
    invoice_id: "INV-2025-08842",
    supplier: "Northwind Office Supplies Ltd.",
    invoice_date: "2025-10-14",
    total_amount: 4187.0,
    currency: "GBP",
    status: "pending",
  },
  {
    invoice_id: "INV-2026-0417",
    supplier: "Acme Industrial Supply",
    invoice_date: "2026-06-09",
    total_amount: 3820.75,
    currency: "USD",
    status: "pending",
  },
  {
    invoice_id: "INV-2026-0416",
    supplier: "Globex Materials GmbH",
    invoice_date: "2026-06-05",
    total_amount: 28990.5,
    currency: "EUR",
    status: "error",
  },
  {
    invoice_id: "INV-2026-0415",
    supplier: "Initech Software Services",
    invoice_date: "2026-05-30",
    total_amount: 7600.0,
    currency: "USD",
    status: "approved",
  },
  {
    invoice_id: "INV-2026-0414",
    supplier: "Umbrella Facilities Co.",
    invoice_date: "2026-05-22",
    total_amount: 1545.2,
    currency: "USD",
    status: "approved",
  },
];

/* A public sample PDF used for the preview panel. */
window.SAMPLE_PDF_URL =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/web/compressed.tracemonkey-pldi-09.pdf";

/* Small helper to build a {match, confidence} field. */
function fld(match, confidence) {
  return [{ match: match, confidence: confidence, typed_value: null }];
}

/* Build a mock latest-invoice response matching the live endpoint shape:
   { pdf_url, validations, extracted }. */
window.buildMockReview = function () {
  return {
    extracted: {
      "Invoice Number": fld("INV-2025-08842", 0.9917),
      "Invoice Date": fld("14-10-2025", 0.9942),
      "Vendor Name": fld("Northwind Office Supplies Ltd.", 0.9731),
      "Vendor Address": fld(
        "120 Harbor Road, Suite 400, Bristol, BS1 5TY",
        0.8421
      ),
      "Vendor VAT Number": fld("GB 482 9100 37", 0.7689),
      "Customer Name": fld("Stellar Dynamics Ltd.", 0.9555),
      "Customer Address": fld("8 Kingsway, London, WC2B 6XF", 0.8123),
      "Invoice Total": fld("£ 4,187.00", 0.9853),
      Subtotal: fld("£ 3,489.17", 0.9611),
      "Total Tax": fld("£ 697.83", 0.9488),
      "Tax Percentage": fld("20%", 0.8802),
      Currency: fld("GBP", 0.9971),
      "Payment Due Date": fld("13-11-2025", 0.9344),
      "Payment Terms": fld("Net 30", 0.8567),
      "Purchase Order Number": fld("PO-55831", 0.7912),
      "Account Number": fld("31926048", 0.9102),
      "IBAN Number": fld("GB29 NWBK 6016 1331 9268 19", 0.8845),
      Table: [
        {
          "Item Description": {
            match: "Ergonomic Mesh Office Chair (black)",
            confidence: 0.5729,
          },
          Quantity: { match: "8", confidence: 0.979 },
          "Unit Price": { match: "£ 289.00", confidence: 0.9699 },
          Total: { match: "£ 2,312.00", confidence: 0.9853 },
        },
        {
          "Item Description": {
            match: "Height-Adjustable Standing Desk",
            confidence: 0.8841,
          },
          Quantity: { match: "3", confidence: 0.9912 },
          "Unit Price": { match: "£ 459.00", confidence: 0.9521 },
          Total: { match: "£ 1,377.00", confidence: 0.9744 },
        },
        {
          "Item Description": {
            match: "Desk Cable Management Tray",
            confidence: 0.7314,
          },
          Quantity: { match: "10", confidence: 0.9663 },
          "Unit Price": { match: "£ 49.80", confidence: 0.9408 },
          Total: { match: "£ 498.00", confidence: 0.9587 },
        },
      ],
    },
    validations: {
      rule01_invoice_number_present: true,
      rule02_invoice_date_format: true,
      rule03_vendor_details_present: true,
      rule04_currency_present: true,
      rule05_has_line_items: true,
      rule06_line_total_matches: true,
      rule07_due_date_matches_terms: false,
      rule08_po_referenced: true,
      rule09_vat_matches: false,
      rule10_iban_and_account_present: true,
    },
    pdf_url: window.SAMPLE_PDF_URL,
  };
};
