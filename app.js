/* ============================================================
   Invoice Review — application logic (vanilla JS)
   One file drives both pages; the bottom bootstrap dispatches
   on document.body.dataset.page.
   ============================================================ */

(function () {
  "use strict";

  /* ---------------- Networking ---------------- */

  // The only real backend call: returns the most recently processed invoice
  // as { pdf_url, validations, extracted }. Results are cached per browser
  // tab (sessionStorage) so navigating between pages reuses a recent result
  // instead of re-hitting the network (or falling back to mock data).
  var LATEST_INVOICE_URL =
    "https://digiyatravenki.app.n8n.cloud/webhook-test/latest-invoice";
  var LATEST_INVOICE_CACHE_KEY = "latestInvoiceCache";
  var LATEST_INVOICE_CACHE_TTL_MS = 60000; // 60s freshness window

  function readInvoiceCache() {
    try {
      const raw = sessionStorage.getItem(LATEST_INVOICE_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.data) return null;
      return parsed; // { ts, data }
    } catch (e) {
      return null;
    }
  }

  function writeInvoiceCache(data) {
    try {
      sessionStorage.setItem(
        LATEST_INVOICE_CACHE_KEY,
        JSON.stringify({ ts: Date.now(), data: data })
      );
    } catch (e) {
      /* sessionStorage unavailable / full — non-fatal */
    }
  }

  async function loadLatestInvoice(forceRefresh) {
    // 1. Serve a fresh cached value without touching the network.
    if (!forceRefresh) {
      const cached = readInvoiceCache();
      if (cached && Date.now() - cached.ts < LATEST_INVOICE_CACHE_TTL_MS) {
        return cached.data;
      }
    }

    // 2. Attempt the real fetch.
    try {
      const res = await fetch(LATEST_INVOICE_URL, { method: "POST" });
      if (!res.ok) throw new Error("status " + res.status);
      const data = await res.json();
      writeInvoiceCache(data);
      return data;
    } catch (err) {
      // 3. Prefer any previously cached real data (even if stale) over mock.
      const cached = readInvoiceCache();
      if (cached && cached.data) return cached.data;
      throw err; // caller falls back to mock data as the last resort
    }
  }

  /* ---------------- Helpers / formatters ---------------- */

  function escapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatCurrency(amount, currency) {
    if (amount === null || amount === undefined || isNaN(amount)) return "—";
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency || "USD",
      }).format(amount);
    } catch (e) {
      return (currency || "") + " " + Number(amount).toFixed(2);
    }
  }

  function formatDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  /**
   * Convert an extraction confidence (0..1) to a whole-number percent.
   * Returns null when no usable confidence is present.
   *   formatConfidence(0.9845619919102743) -> 98
   */
  function formatConfidence(value) {
    if (value === null || value === undefined || isNaN(value)) return null;
    return Math.round(Number(value) * 100);
  }

  /** Maps a status string to a badge CSS modifier. */
  function statusBadge(status) {
    const s = String(status || "").toLowerCase();
    let mod = "pending";
    if (s === "approved" || s === "valid" || s === "ok") mod = "approved";
    else if (s === "error" || s === "rejected" || s === "failed") mod = "error";
    return (
      '<span class="badge badge--' +
      mod +
      '">' +
      escapeHtml(status || "unknown") +
      "</span>"
    );
  }

  function showNotice(id, message) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = message;
    el.classList.add("is-visible");
  }

  /* ============================================================
     OVERVIEW PAGE
     ============================================================ */

  // Build a single overview-row summary from a latest-invoice payload.
  function summarizeInvoice(data) {
    const ex = (data && data.extracted) || {};
    const validations = (data && data.validations) || {};
    function first(key) {
      const arr = ex[key];
      return Array.isArray(arr) && arr.length ? arr[0].match : "";
    }
    const keys = Object.keys(validations);
    const allPass = keys.length > 0 && keys.every(function (k) {
      return validations[k] === true;
    });
    return {
      invoice_id: first("Invoice Number") || "Latest invoice",
      supplier: first("Vendor Name"),
      invoice_date: first("Invoice Date"),
      // Already a formatted string from extraction (e.g. "£ 4,187.00").
      total_amount: first("Invoice Total"),
      status: allPass ? "approved" : "pending",
    };
  }

  async function loadInvoices() {
    try {
      // loadLatestInvoice() already returns cached real data on fetch
      // failure, so we only land in catch when there is genuinely nothing.
      const data = await loadLatestInvoice();
      renderInvoiceList([summarizeInvoice(data)]);
    } catch (err) {
      // No mock fallback — show a neutral empty state.
      renderInvoiceList([]);
    }
    // Reflect an Accept/Reject decision carried over from the review screen.
    applyStoredStatus();
  }

  /**
   * If the review screen recorded a decision, update the rendered row's
   * status badge to match, then clear it so it doesn't persist.
   */
  function applyStoredStatus() {
    let status = null;
    try {
      status = sessionStorage.getItem("invoiceStatus");
      if (status) sessionStorage.removeItem("invoiceStatus");
    } catch (e) {
      status = null;
    }
    if (!status) return;

    const tbody = document.getElementById("invoice-list");
    if (!tbody) return;
    const row = tbody.querySelector("tr[data-id]");
    if (!row) return;
    const statusCell = row.cells[row.cells.length - 1];
    if (statusCell) statusCell.innerHTML = statusBadge(status);
  }

  function renderInvoiceList(invoices) {
    const tbody = document.getElementById("invoice-list");
    if (!tbody) return;

    if (!invoices || invoices.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="5"><div class="state">No invoices available.</div></td></tr>';
      return;
    }

    tbody.innerHTML = invoices
      .map(function (inv) {
        const id = inv.invoice_id;
        // total may be a preformatted string or a number.
        const amount =
          typeof inv.total_amount === "number"
            ? formatCurrency(inv.total_amount, inv.currency)
            : inv.total_amount || "—";
        return (
          '<tr tabindex="0" role="link" data-id="' +
          escapeHtml(id) +
          '">' +
          '<td class="cell-id">' +
          escapeHtml(id) +
          "</td>" +
          "<td>" +
          escapeHtml(inv.supplier) +
          "</td>" +
          '<td class="text-muted">' +
          escapeHtml(formatDate(inv.invoice_date)) +
          "</td>" +
          '<td class="cell-amount">' +
          escapeHtml(amount) +
          "</td>" +
          "<td>" +
          statusBadge(inv.status) +
          "</td>" +
          "</tr>"
        );
      })
      .join("");

    // There is only ever the latest invoice — navigate without an id param.
    function go() {
      window.location.href = "review.html";
    }
    Array.prototype.forEach.call(
      tbody.querySelectorAll("tr[data-id]"),
      function (row) {
        const id = row.getAttribute("data-id");
        row.addEventListener("click", function () {
          go();
        });
        row.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            go();
          }
        });
        row.addEventListener("contextmenu", function (e) {
          e.preventDefault();
          renderContextMenu(id, e.clientX, e.clientY);
        });
      }
    );
  }

  /* ---------------- Context menu (overview) ---------------- */

  function closeContextMenu() {
    const m = document.getElementById("context-menu");
    if (m && m.parentNode) m.parentNode.removeChild(m);
  }

  function renderContextMenu(invoiceId, x, y) {
    closeContextMenu();

    const menu = document.createElement("div");
    menu.className = "context-menu";
    menu.id = "context-menu";
    menu.setAttribute("role", "menu");
    menu.innerHTML =
      '<button class="context-menu__item" type="button" data-action="open" role="menuitem">Open</button>' +
      '<button class="context-menu__item context-menu__item--danger" type="button" data-action="delete" role="menuitem">Delete</button>';
    document.body.appendChild(menu);

    // Keep the menu within the viewport (position: fixed -> client coords).
    const rect = menu.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth) {
      left = Math.max(8, window.innerWidth - rect.width - 8);
    }
    if (top + rect.height > window.innerHeight) {
      top = Math.max(8, window.innerHeight - rect.height - 8);
    }
    menu.style.left = left + "px";
    menu.style.top = top + "px";

    menu
      .querySelector('[data-action="open"]')
      .addEventListener("click", function (e) {
        e.stopPropagation();
        closeContextMenu();
        // Only ever the latest invoice — navigate without an id param.
        window.location.href = "review.html";
      });
    menu
      .querySelector('[data-action="delete"]')
      .addEventListener("click", function (e) {
        e.stopPropagation();
        closeContextMenu();
        deleteInvoice(invoiceId);
      });
  }

  // Local-only delete: no backend call — just drop the row and confirm.
  function deleteInvoice(invoiceId) {
    if (
      !window.confirm(
        "Delete invoice " + invoiceId + "?\nThis action cannot be undone."
      )
    ) {
      return;
    }
    removeInvoiceRow(invoiceId);
    showToast("Invoice removed", "info");
  }

  function removeInvoiceRow(invoiceId) {
    const tbody = document.getElementById("invoice-list");
    if (!tbody) return;
    Array.prototype.forEach.call(
      tbody.querySelectorAll("tr[data-id]"),
      function (row) {
        if (row.getAttribute("data-id") === invoiceId && row.parentNode) {
          row.parentNode.removeChild(row);
        }
      }
    );
    if (!tbody.querySelector("tr[data-id]")) {
      tbody.innerHTML =
        '<tr><td colspan="5"><div class="state">No invoices to review.</div></td></tr>';
    }
  }

  function initOverview() {
    loadInvoices();
    // Dismiss the context menu on any outside interaction.
    document.addEventListener("click", closeContextMenu);
    document.addEventListener("scroll", closeContextMenu, true);
    window.addEventListener("resize", closeContextMenu);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeContextMenu();
    });
  }

  /* ============================================================
     REVIEW PAGE
     ============================================================ */

  // Ordered field layout (keys match the extraction API `matches`).
  const FIELD_SECTIONS = [
    {
      title: "Invoice Details",
      fields: [
        "Invoice Number",
        "Invoice Date",
        "Purchase Order Number",
        "Currency",
        "Payment Due Date",
        "Payment Terms",
      ],
    },
    {
      title: "Vendor",
      fields: ["Vendor Name", "Vendor Address", "Vendor VAT Number"],
    },
    { title: "Customer", fields: ["Customer Name", "Customer Address"] },
    {
      title: "Amounts",
      fields: ["Subtotal", "Total Tax", "Tax Percentage", "Invoice Total"],
    },
    { title: "Banking", fields: ["Account Number", "IBAN Number"] },
  ];

  const TOP_LEVEL_FIELDS = FIELD_SECTIONS.reduce(function (acc, s) {
    return acc.concat(s.fields);
  }, []);

  const TABLE_COLUMNS = ["Item Description", "Quantity", "Unit Price", "Total"];

  // Review editing state.
  const reviewState = {
    invoiceId: null,
    extracted: {}, // field key -> { value, confidence }
    edited: {}, // field key -> corrected value (differs from extracted)
    dirty: false, // unsaved changes since last save?
  };

  async function loadReviewData() {
    try {
      return await loadLatestInvoice();
    } catch (err) {
      showNotice(
        "review-notice",
        "Live data unavailable — showing bundled demo invoice."
      );
      return window.buildMockReview ? window.buildMockReview() : null;
    }
  }

  /**
   * Normalize the latest-invoice response { pdf_url, validations, extracted }
   * into { matches, validations, name, pdf_url } for the render functions.
   */
  function normalizeReview(data) {
    if (!data) return null;
    const matches = data.extracted || {};
    const pdf_url = data.pdf_url || window.SAMPLE_PDF_URL || "";
    let name = data.name || "";
    if (!name && pdf_url) {
      // Derive a filename from the PDF URL for the Document info card.
      name = decodeURIComponent(pdf_url.split("/").pop().split("?")[0] || "");
    }
    return {
      matches: matches,
      validations: data.validations || {},
      name: name,
      pdf_url: pdf_url,
    };
  }

  /** First {match, confidence} for a top-level field, or null. */
  function getMatch(matches, key) {
    const arr = matches && matches[key];
    return Array.isArray(arr) && arr.length ? arr[0] : null;
  }

  /** Renders a confidence badge, color-coded; empty string when absent. */
  function confidenceBadgeHtml(confidence) {
    const pct = formatConfidence(confidence);
    if (pct === null) return "";
    const cls = pct >= 90 ? "confidence-success" : "confidence-warning";
    return (
      '<span class="confidence-badge ' +
      cls +
      '" title="Extraction confidence">' +
      pct +
      "%</span>"
    );
  }

  function editedIndicatorHtml() {
    return (
      '<span class="edited-indicator" title="Manually corrected — confidence no longer applies">Edited</span>'
    );
  }

  /** One editable label/value row for a top-level field. */
  function fieldRowEditable(label, key, matchObj) {
    const val = matchObj && matchObj.match != null ? String(matchObj.match) : "";
    const conf =
      matchObj && typeof matchObj.confidence === "number"
        ? matchObj.confidence
        : null;
    reviewState.extracted[key] = { value: val, confidence: conf };

    return (
      '<div class="field-row">' +
      '<div class="field-label">' +
      escapeHtml(label) +
      "</div>" +
      '<div class="field-value-line">' +
      '<div class="field-value-wrap">' +
      '<i class="ti ti-edit field-pencil" aria-hidden="true"></i>' +
      '<input class="field-input" type="text" data-field="' +
      escapeHtml(key) +
      '" value="' +
      escapeHtml(val) +
      '" title="' +
      escapeHtml(val) +
      '" placeholder="—" aria-label="' +
      escapeHtml(label) +
      '">' +
      "</div>" +
      '<span class="field-indicator">' +
      confidenceBadgeHtml(conf) +
      "</span>" +
      "</div>" +
      "</div>"
    );
  }

  /** One editable table cell for a line item. */
  function tableCellEditable(key, cell, isNum) {
    const val = cell && cell.match != null ? String(cell.match) : "";
    const conf =
      cell && typeof cell.confidence === "number" ? cell.confidence : null;
    reviewState.extracted[key] = { value: val, confidence: conf };

    return (
      "<td" +
      (isNum ? ' class="num"' : "") +
      ">" +
      '<div class="cell-edit ' +
      (isNum ? "cell-edit--num" : "cell-edit--desc") +
      '">' +
      '<input class="field-input' +
      (isNum ? " field-input--num" : "") +
      '" type="text" data-field="' +
      escapeHtml(key) +
      '" value="' +
      escapeHtml(val) +
      '" title="' +
      escapeHtml(val) +
      '" placeholder="—">' +
      '<span class="field-indicator">' +
      confidenceBadgeHtml(conf) +
      "</span>" +
      "</div>" +
      "</td>"
    );
  }

  function renderInvoice(matches) {
    const el = document.getElementById("invoice-panel");
    if (!el) return;

    // Reset edit state for a fresh render.
    reviewState.extracted = {};
    reviewState.edited = {};
    reviewState.dirty = false;

    if (!matches) {
      el.innerHTML = '<div class="state">No invoice data.</div>';
      updateUnsavedUI();
      return;
    }

    let html = "";

    FIELD_SECTIONS.forEach(function (sec, idx) {
      const sectionId = "fsec-" + idx;
      html +=
        '<section class="field-section is-open" data-section="' +
        sectionId +
        '">' +
        '<button class="field-section__header" type="button" aria-expanded="true">' +
        '<span class="field-section__title">' +
        escapeHtml(sec.title) +
        "</span>" +
        '<i class="ti ti-chevron-down field-section__chevron" aria-hidden="true"></i>' +
        "</button>" +
        '<div class="field-section__body">';
      sec.fields.forEach(function (key) {
        html += fieldRowEditable(key, key, getMatch(matches, key));
      });
      html += "</div></section>";
    });

    el.innerHTML = html;

    // Collapsible section toggles (default expanded).
    Array.prototype.forEach.call(
      el.querySelectorAll(".field-section__header"),
      function (header) {
        header.addEventListener("click", function () {
          const section = header.closest(".field-section");
          const open = section.classList.toggle("is-open");
          header.setAttribute("aria-expanded", open ? "true" : "false");
        });
      }
    );

    // Wire change tracking on the top-level field inputs.
    Array.prototype.forEach.call(
      el.querySelectorAll(".field-input"),
      function (input) {
        input.addEventListener("input", onFieldInput);
      }
    );

    updateUnsavedUI();
  }

  /** Renders the line items as their own editable, confidence-scored table. */
  function renderLineItems(matches) {
    const el = document.getElementById("line-items-panel");
    if (!el) return;

    const table = matches && Array.isArray(matches.Table) ? matches.Table : [];
    if (!table.length) {
      el.innerHTML = '<div class="state">No line items extracted.</div>';
      return;
    }

    let html = '<div class="table-wrap">';
    html += '<table class="line-items"><thead><tr>';
    html +=
      "<th>Item Description</th><th class='num'>Quantity</th>" +
      "<th class='num'>Unit Price</th><th class='num'>Total</th>";
    html += "</tr></thead><tbody>";
    table.forEach(function (row, i) {
      row = row || {};
      html +=
        "<tr>" +
        tableCellEditable(
          "Table[" + i + "].Item Description",
          row["Item Description"],
          false
        ) +
        tableCellEditable("Table[" + i + "].Quantity", row["Quantity"], true) +
        tableCellEditable("Table[" + i + "].Unit Price", row["Unit Price"], true) +
        tableCellEditable("Table[" + i + "].Total", row["Total"], true) +
        "</tr>";
    });
    html += "</tbody></table></div>";

    el.innerHTML = html;

    // Wire change tracking on the line-item inputs.
    Array.prototype.forEach.call(
      el.querySelectorAll(".field-input"),
      function (input) {
        input.addEventListener("input", onFieldInput);
      }
    );
  }

  /** Track an inline edit: update state + swap confidence/Edited indicator. */
  function onFieldInput(e) {
    const input = e.target;
    const key = input.getAttribute("data-field");
    const ext = reviewState.extracted[key] || { value: "", confidence: null };
    const container =
      input.closest(".field-value-line") || input.closest(".cell-edit");
    const indicator = container
      ? container.querySelector(".field-indicator")
      : null;

    input.title = input.value;

    if (input.value !== ext.value) {
      reviewState.edited[key] = input.value;
      input.classList.add("is-edited");
      if (indicator) indicator.innerHTML = editedIndicatorHtml();
    } else {
      delete reviewState.edited[key];
      input.classList.remove("is-edited");
      if (indicator) indicator.innerHTML = confidenceBadgeHtml(ext.confidence);
    }

    reviewState.dirty = true;
    updateUnsavedUI();
  }

  function updateUnsavedUI() {
    const ind = document.getElementById("unsaved-indicator");
    const btn = document.getElementById("save-btn");
    if (ind) ind.classList.toggle("is-visible", reviewState.dirty);
    // Stay clickable; only the appearance is muted when nothing to save.
    if (btn) btn.classList.toggle("is-idle", !reviewState.dirty);
  }

  // Visual-only: persists corrections in local state, no backend call.
  function saveInvoiceChanges() {
    // Nothing to save — harmless no-op so the button is never "stuck".
    if (!reviewState.dirty && Object.keys(reviewState.edited).length === 0) {
      showToast("No changes to save.", "info");
      return;
    }
    // Corrections persist (Edited badges stay); only "unsaved" clears.
    reviewState.dirty = false;
    updateUnsavedUI();
    showToast("Changes saved.", "success");
  }

  /**
   * Visual-only decision handler for Accept / Reject (no backend call).
   * Records the decision in sessionStorage and returns to the overview so
   * the status badge there reflects it.
   */
  function decideInvoice(action) {
    const isAccept = action === "accept";
    const status = isAccept ? "approved" : "rejected";

    // Persist any pending edits first (local only) and clear the unsaved
    // guard so beforeunload doesn't block the navigation below.
    reviewState.dirty = false;
    updateUnsavedUI();

    try {
      sessionStorage.setItem("invoiceStatus", status);
    } catch (e) {
      /* sessionStorage unavailable — non-fatal */
    }

    showToast(
      isAccept ? "Invoice accepted." : "Invoice rejected.",
      isAccept ? "success" : "danger"
    );

    // Brief delay so the toast is visible before navigating back.
    setTimeout(function () {
      window.location.href = "index.html";
    }, 1000);
  }

  function acceptInvoice() {
    return decideInvoice("accept");
  }

  function rejectInvoice() {
    return decideInvoice("reject");
  }

  /** Transient toast confirmation. type: "success" | "danger" | "info". */
  function showToast(message, type) {
    const container = document.getElementById("toast-container");
    if (!container) {
      // Fallback to the notice banner if the container is absent.
      showNotice("review-notice", message);
      return;
    }
    const toast = document.createElement("div");
    toast.className = "toast toast--" + (type || "info");
    toast.textContent = message;
    container.appendChild(toast);
    // Trigger enter transition.
    requestAnimationFrame(function () {
      toast.classList.add("is-visible");
    });
    setTimeout(function () {
      toast.classList.remove("is-visible");
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    }, 3500);
  }

  // The 10 validation rules, in display order: [payload key, human label].
  const VALIDATION_RULES = [
    ["rule01_invoice_number_present", "Invoice number is present"],
    [
      "rule02_invoice_date_format",
      "Invoice date is present and follows the dd-mm-yyyy format",
    ],
    [
      "rule03_vendor_details_present",
      "Vendor details are present: name, address, tax ID",
    ],
    ["rule04_currency_present", "Currency is present"],
    ["rule05_has_line_items", "Invoice contains at least one line item"],
    [
      "rule06_line_total_matches",
      "Line items amount matches the total value on the invoice",
    ],
    [
      "rule07_due_date_matches_terms",
      "Due date matches the stated payment terms",
    ],
    ["rule08_po_referenced", "Purchase Order is referenced"],
    [
      "rule09_vat_matches",
      "Calculated VAT amount matches the percentage of the total on the invoice",
    ],
    [
      "rule10_iban_and_account_present",
      "IBAN and account number are present on the invoice",
    ],
  ];

  /**
   * Renders the 10 fixed validation rules. Each value in `validations` is a
   * boolean (true = pass, false = fail); a missing key shows "Not evaluated".
   */
  function renderValidations(validations) {
    const el = document.getElementById("validation-panel");
    if (!el) return;
    validations = validations || {};

    const counts = { pass: 0, fail: 0, na: 0 };
    VALIDATION_RULES.forEach(function (r) {
      const v = validations[r[0]];
      if (v === true) counts.pass++;
      else if (v === false) counts.fail++;
      else counts.na++;
    });

    let html = '<div class="validation-summary">';
    html +=
      '<span class="badge badge--approved">' + counts.pass + " passed</span>";
    if (counts.fail)
      html +=
        '<span class="badge badge--error">' + counts.fail + " failed</span>";
    if (counts.na)
      html +=
        '<span class="badge badge--pending">' +
        counts.na +
        " not evaluated</span>";
    html += "</div>";

    html += '<ul class="validation-list">';
    VALIDATION_RULES.forEach(function (r) {
      const v = validations[r[0]];
      let state, icon, label;
      if (v === true) {
        state = "pass";
        icon = "✓";
        label = "Pass";
      } else if (v === false) {
        state = "fail";
        icon = "✕";
        label = "Fail";
      } else {
        state = "na";
        icon = "–";
        label = "Not evaluated";
      }
      html +=
        '<li class="validation-item validation-item--' +
        state +
        '">' +
        '<span class="validation-item__icon">' +
        icon +
        "</span>" +
        '<div class="validation-item__body">' +
        '<div class="validation-item__rule">' +
        escapeHtml(r[1]) +
        "</div>" +
        "</div>" +
        '<span class="validation-result validation-result--' +
        state +
        '">' +
        label +
        "</span>" +
        "</li>";
    });
    html += "</ul>";

    el.innerHTML = html;
  }

  /* ---------------- PDF.js rendering ---------------- */

  const pdfState = { doc: null, page: 1, total: 0, rendering: false };

  function setPdfStatus(message, isError) {
    const el = document.getElementById("pdf-status");
    if (!el) return;
    el.innerHTML = message;
    el.style.color = isError ? "#ffd5d0" : "#e4e7eb";
  }

  function renderPDF(pdfUrl) {
    const canvas = document.getElementById("pdf-canvas");
    if (!canvas) return;

    if (!pdfUrl) {
      setPdfStatus("No document available for this invoice.", true);
      return;
    }
    if (typeof window.pdfjsLib === "undefined") {
      setPdfStatus(
        'PDF viewer failed to load. <a href="' +
          escapeHtml(pdfUrl) +
          '" target="_blank" rel="noopener">Open PDF</a>',
        true
      );
      return;
    }

    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

    setPdfStatus('<span class="spinner"></span> Loading document…');

    window.pdfjsLib
      .getDocument(pdfUrl)
      .promise.then(function (doc) {
        pdfState.doc = doc;
        pdfState.total = doc.numPages;
        pdfState.page = 1;
        updatePdfControls();
        return renderPdfPage(pdfState.page);
      })
      .catch(function (err) {
        setPdfStatus(
          'Unable to render preview. <a href="' +
            escapeHtml(pdfUrl) +
            '" target="_blank" rel="noopener">Open PDF in a new tab</a>',
          true
        );
      });
  }

  function renderPdfPage(num) {
    if (!pdfState.doc || pdfState.rendering) return Promise.resolve();
    pdfState.rendering = true;

    return pdfState.doc
      .getPage(num)
      .then(function (page) {
        const canvas = document.getElementById("pdf-canvas");
        const ctx = canvas.getContext("2d");
        const wrap = canvas.parentElement;
        const baseViewport = page.getViewport({ scale: 1 });
        const targetWidth = Math.min(wrap.clientWidth || 600, 900);
        const scale = targetWidth / baseViewport.width;
        const viewport = page.getViewport({ scale: scale });
        const ratio = window.devicePixelRatio || 1;

        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = Math.floor(viewport.width) + "px";
        canvas.style.height = Math.floor(viewport.height) + "px";

        return page
          .render({
            canvasContext: ctx,
            viewport: viewport,
            transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null,
          })
          .promise.then(function () {
            pdfState.rendering = false;
            setPdfStatus("Page " + num + " of " + pdfState.total);
            updatePdfControls();
          });
      })
      .catch(function () {
        pdfState.rendering = false;
      });
  }

  function updatePdfControls() {
    const prev = document.getElementById("pdf-prev");
    const next = document.getElementById("pdf-next");
    if (prev) prev.disabled = pdfState.page <= 1;
    if (next) next.disabled = pdfState.page >= pdfState.total;
  }

  function initPdfControls() {
    const prev = document.getElementById("pdf-prev");
    const next = document.getElementById("pdf-next");
    if (prev)
      prev.addEventListener("click", function () {
        if (pdfState.page > 1) {
          pdfState.page--;
          renderPdfPage(pdfState.page);
        }
      });
    if (next)
      next.addEventListener("click", function () {
        if (pdfState.page < pdfState.total) {
          pdfState.page++;
          renderPdfPage(pdfState.page);
        }
      });
  }

  /**
   * Wires the lazy PDF placeholder: PDF.js and the document binary are only
   * fetched (via renderPDF) when the user clicks the placeholder.
   */
  function setupPdfLazyLoad(pdfUrl) {
    const placeholder = document.getElementById("pdf-placeholder");
    if (!placeholder) return;

    placeholder.addEventListener(
      "click",
      function () {
        const wrap = document.getElementById("pdf-canvas-wrap");
        const toolbar = document.getElementById("pdf-toolbar");
        // Placeholder is replaced entirely by the canvas; controls appear.
        // Use an explicit class (visible in DevTools) for robust hiding.
        placeholder.classList.add("is-hidden");
        if (wrap) wrap.classList.remove("is-hidden");
        if (toolbar) toolbar.classList.remove("is-hidden");
        // Debug aid: confirm the placeholder is truly removed from layout.
        console.log(
          "[pdf] placeholder hidden:",
          placeholder.classList.contains("is-hidden"),
          "computed display:",
          window.getComputedStyle(placeholder).display
        );
        renderPDF(pdfUrl);
      },
      { once: true }
    );
  }

  /** Fills the always-visible "Document info" card. */
  function renderDocInfo(doc) {
    const nameEl = document.getElementById("doc-info-name");
    if (nameEl) {
      const filename = (doc && doc.name) || "Not provided";
      nameEl.textContent = filename;
      nameEl.title = filename;
    }
  }

  async function initReview() {
    initPdfControls();

    // Save / Accept / Reject actions + unsaved-changes guard.
    const saveBtn = document.getElementById("save-btn");
    if (saveBtn) saveBtn.addEventListener("click", saveInvoiceChanges);
    const acceptBtn = document.getElementById("accept-btn");
    if (acceptBtn) acceptBtn.addEventListener("click", acceptInvoice);
    const rejectBtn = document.getElementById("reject-btn");
    if (rejectBtn) rejectBtn.addEventListener("click", rejectInvoice);
    window.addEventListener("beforeunload", function (e) {
      if (reviewState.dirty) {
        e.preventDefault();
        e.returnValue = "";
        return "";
      }
    });
    updateUnsavedUI();

    const data = await loadReviewData();
    const doc = normalizeReview(data);
    if (!doc) {
      renderInvoice(null);
      renderLineItems(null);
      renderValidations({});
      return;
    }

    // Title reflects the latest invoice's number (no id in the URL anymore).
    const titleEl = document.getElementById("review-invoice-id");
    if (titleEl) {
      const num = getMatch(doc.matches, "Invoice Number");
      titleEl.textContent = (num && num.match) || "Latest invoice";
    }

    renderInvoice(doc.matches);
    renderLineItems(doc.matches);
    renderValidations(doc.validations);
    renderDocInfo(doc);
    setupPdfLazyLoad(doc.pdf_url);

    // Re-fit the PDF on resize (debounced) — only once it has loaded.
    let resizeTimer;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (pdfState.doc) renderPdfPage(pdfState.page);
      }, 200);
    });
  }

  /* ============================================================
     BOOTSTRAP
     ============================================================ */

  document.addEventListener("DOMContentLoaded", function () {
    const page = document.body.dataset.page;
    if (page === "overview") initOverview();
    else if (page === "review") initReview();
  });

  // Expose key functions for debugging / testing.
  window.InvoiceApp = {
    loadLatestInvoice: loadLatestInvoice,
    formatConfidence: formatConfidence,
    loadInvoices: loadInvoices,
    renderInvoiceList: renderInvoiceList,
    renderContextMenu: renderContextMenu,
    deleteInvoice: deleteInvoice,
    loadReviewData: loadReviewData,
    renderInvoice: renderInvoice,
    renderLineItems: renderLineItems,
    renderValidations: renderValidations,
    renderPDF: renderPDF,
    saveInvoiceChanges: saveInvoiceChanges,
    acceptInvoice: acceptInvoice,
    rejectInvoice: rejectInvoice,
  };
})();
