const path = require("path");
const nodemailer = require("nodemailer");

const LOGO_PATH = path.join(__dirname, "..", "..", "LMS-Quaters_Frontend", "src", "assets", "Logo.png");

function env(name, fallback = "") {
  const value = process.env[name];
  return value == null || value === "" ? fallback : value;
}

function formatDate(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().slice(0, 10);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function uniqEmails(values) {
  return [...new Set(values.map((v) => String(v || "").trim()).filter(Boolean))];
}

function createTransport() {
  const host = env("MAIL_HOST");
  const user = env("MAIL_USER");
  const pass = env("MAIL_PASS");
  const port = Number(env("MAIL_PORT", "587"));
  const secure = env("MAIL_SECURE", "false").toLowerCase() === "true";

  if (!host || !user || !pass) {
    throw new Error("Mail SMTP settings are missing. Set MAIL_HOST, MAIL_PORT, MAIL_USER and MAIL_PASS.");
  }

  return nodemailer.createTransport({
    service: host === "smtp.gmail.com" ? "gmail" : undefined,
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
  });
}

function buildQuarterApprovalBody(application) {
  const reqDate = formatDate(application.ReqDate);
  const appNo = escapeHtml(application.AppNo || "-");
  const empId = escapeHtml(application.EmpId || "-");
  const empName = escapeHtml(application.EmpName || "-");
  const qtrRequested = escapeHtml(application.QtrRequested || "-");
  const qtrType = escapeHtml(application.QtrType || "-");
  const qtrLocation = escapeHtml(application.QtrLocation || "-");
  const status = escapeHtml(application.Status || "approved");
  const quarterLabel = [
    application.QtrRequested ? `Quarter: ${escapeHtml(application.QtrRequested)}` : null,
    application.QtrType ? `Type: ${escapeHtml(application.QtrType)}` : null,
    application.QtrLocation ? `Location: ${escapeHtml(application.QtrLocation)}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const details = [
    ["Application No", appNo],
    ["Employee ID", empId],
    ["Employee Name", empName],
    ["Request Date", escapeHtml(reqDate)],
    ["Requested Quarter", qtrRequested],
    ["Quarter Type", qtrType],
    ["Location", qtrLocation],
    ["Status", status],
  ].filter(([, value]) => value != null && String(value).trim() !== "");

  const detailRows = details
    .map(([label, value]) => `<tr><td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;background:#f8fafc;font-weight:700;color:#475569;width:38%;">${escapeHtml(label)}</td><td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-weight:600;">${String(value)}</td></tr>`)
    .join("");

  const textLines = [
    `Hello ${application.EmpName || "-"}, your quarter application has been approved.`,
    quarterLabel ? quarterLabel : "",
    "",
    `Application No: ${application.AppNo || "-"}`,
    `Employee ID: ${application.EmpId || "-"}`,
    `Employee Name: ${application.EmpName || "-"}`,
    `Request Date: ${reqDate || "-"}`,
    `Requested Quarter: ${application.QtrRequested || "-"}`,
    `Quarter Type: ${application.QtrType || "-"}`,
    `Location: ${application.QtrLocation || "-"}`,
    `Status: ${application.Status || "Approved"}`,
  ].filter((line) => line !== "").join("\n");

  const html = `
    <div style="margin:0;padding:0;background:#eef2ff;">
      <div style="max-width:720px;margin:0 auto;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#0f172a;line-height:1.5;">
        <div style="background:linear-gradient(135deg,#0f172a 0%,#1d4ed8 100%);border-radius:18px 18px 0 0;padding:20px 20px;color:#fff;">
          <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr>
              <td style="vertical-align:middle;padding-right:12px;">
                <img src="cid:ppa-logo" alt="Paradip Port Authority logo" style="display:block;width:56px;height:56px;border-radius:14px;object-fit:cover;background:#fff;" />
              </td>
              <td style="vertical-align:middle;">
                <div style="font-size:22px;line-height:1.2;font-weight:700;letter-spacing:0.02em;word-break:break-word;">Paradip Port Authority</div>
                <div style="margin-top:6px;font-size:11px;line-height:1.2;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;word-break:break-word;">Land Management System</div>
              </td>
            </tr>
          </table>
        </div>

        <div style="background:#ffffff;border:1px solid #dbeafe;border-top:none;border-radius:0 0 18px 18px;padding:24px 20px;box-shadow:0 18px 45px rgba(15,23,42,0.08);">
          <p style="margin:0 0 18px;font-size:medium;font-weight:bold;line-height:1.25;color:#0f172a;">Hello <span style="color:#1d4ed8;">${empName}</span>, your quarter application has been approved.</p>

          ${quarterLabel ? `<div style="margin:0 0 22px;padding:14px 16px;border-left:4px solid #2563eb;background:#eff6ff;border-radius:10px;color:#1e3a8a;font-size:14px;font-weight:600;">${quarterLabel}</div>` : ""}

          <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;font-size:14px;">
            <tbody>${detailRows}</tbody>
          </table>

          <div style="margin-top:22px;padding:16px 18px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;color:#475569;font-size:13px;">
            If you have any questions, contact the quarters administration office.
          </div>

          <p style="margin:20px 0 0;color:#64748b;font-size:12px;">
            This is an automated message from the LMS Quarters portal. Please do not reply to this email.
          </p>
        </div>
      </div>
    </div>
  `;

  return { text: textLines, html };
}

async function sendQuarterApprovalEmail(application) {
  const overrideRecipient = env("MAIL_TO_OVERRIDE");
  const recipients = overrideRecipient
    ? uniqEmails([overrideRecipient])
    : uniqEmails([application.EmailId, application.UserEmail]);
  if (!recipients.length) {
    throw new Error("No recipient email address found for the approved application.");
  }

  const transporter = createTransport();
  const subject = `Quarter application approved${application.AppNo ? ` - ${application.AppNo}` : ""}`;
  const body = buildQuarterApprovalBody(application);

  await transporter.sendMail({
    from: env("MAIL_FROM", env("MAIL_USER")),
    to: recipients.join(", "),
    subject,
    text: body.text,
    html: body.html,
    attachments: [
      {
        filename: "Logo.png",
        path: LOGO_PATH,
        cid: "ppa-logo",
      },
    ],
  });

  return { recipients };
}

async function sendCircularEmail(emails, file, fromDate, toDate) {
  if (!emails || emails.length === 0) {
    throw new Error("No recipient email addresses provided for the circular.");
  }

  const transporter = createTransport();
  const subject = `New Quarter Application Window Open`;

  const formattedFrom = formatDate(fromDate);
  const formattedTo = formatDate(toDate);

  const textLines = [
    `Hello, a new quarter application window is now open.`,
    `You can apply from ${formattedFrom} to ${formattedTo}.`,
    `Please find the attached circular for more details.`
  ].join("\n");

  const html = `
    <div style="margin:0;padding:0;background:#eef2ff;">
      <div style="max-width:720px;margin:0 auto;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#0f172a;line-height:1.5;">
        <div style="background:linear-gradient(135deg,#0f172a 0%,#1d4ed8 100%);border-radius:18px 18px 0 0;padding:20px 20px;color:#fff;">
          <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr>
              <td style="vertical-align:middle;padding-right:12px;">
                <img src="cid:ppa-logo" alt="Paradip Port Authority logo" style="display:block;width:56px;height:56px;border-radius:14px;object-fit:cover;background:#fff;" />
              </td>
              <td style="vertical-align:middle;">
                <div style="font-size:22px;line-height:1.2;font-weight:700;letter-spacing:0.02em;word-break:break-word;">Paradip Port Authority</div>
                <div style="margin-top:6px;font-size:11px;line-height:1.2;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;word-break:break-word;">Land Management System</div>
              </td>
            </tr>
          </table>
        </div>

        <div style="background:#ffffff;border:1px solid #dbeafe;border-top:none;border-radius:0 0 18px 18px;padding:24px 20px;box-shadow:0 18px 45px rgba(15,23,42,0.08);">
          <p style="margin:0 0 18px;font-size:medium;font-weight:bold;line-height:1.25;color:#0f172a;">Hello, a new <span style="color:#1d4ed8;">Quarter Application Window</span> has been opened.</p>
          
          <div style="margin:0 0 22px;padding:14px 16px;border-left:4px solid #2563eb;background:#eff6ff;border-radius:10px;color:#1e3a8a;font-size:14px;font-weight:600;">
            Window is open from ${formattedFrom} to ${formattedTo}.
          </div>

          <p style="margin:0 0 18px;font-size:14px;color:#0f172a;">Please find the official circular attached to this email for more details and guidelines.</p>

          <p style="margin:20px 0 0;color:#64748b;font-size:12px;">
            This is an automated message from the LMS Quarters portal. Please do not reply to this email.
          </p>
        </div>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from: env("MAIL_FROM", env("MAIL_USER")),
    bcc: emails.join(", "),
    subject,
    text: textLines,
    html,
    attachments: [
      {
        filename: "Logo.png",
        path: LOGO_PATH,
        cid: "ppa-logo",
      },
      ...(file ? [{
        filename: file.originalname,
        path: file.path,
      }] : []),
    ],
  });

  return { recipients: emails.length };
}

async function sendCircularEmailWithBuffer(emails, pdfBuffer, circularData) {
  if (!emails || emails.length === 0) {
    throw new Error("No recipient email addresses provided for the circular.");
  }

  const transporter = createTransport();
  const subject = `New Quarter Application Window Open - Official Circular`;

  const from = circularData.appFromDate || "";
  const to = circularData.appToDate || "";
  const qtyStr = Array.isArray(circularData.quarterTypes)
    ? circularData.quarterTypes.join(", ")
    : (circularData.quarterTypes || "");

  const textLines = [
    `Hello, a new quarter application window is now open.`,
    `Quarter Types: ${qtyStr}`,
    `Application window: ${from} to ${to}.`,
    `Please find the attached official circular for more details.`
  ].join("\n");


  const html = `
    <div style="margin:0;padding:0;background:#eef2ff;">
      <div style="max-width:720px;margin:0 auto;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#0f172a;line-height:1.5;">
        <div style="background:linear-gradient(135deg,#0f172a 0%,#1d4ed8 100%);border-radius:18px 18px 0 0;padding:20px 20px;color:#fff;">
          <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr>
              <td style="vertical-align:middle;padding-right:12px;">
                <img src="cid:ppa-logo" alt="Paradip Port Authority logo" style="display:block;width:56px;height:56px;border-radius:14px;object-fit:cover;background:#fff;" />
              </td>
              <td style="vertical-align:middle;">
                <div style="font-size:22px;line-height:1.2;font-weight:700;letter-spacing:0.02em;">Paradip Port Authority</div>
                <div style="margin-top:6px;font-size:11px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;">Land Management System</div>
              </td>
            </tr>
          </table>
        </div>
        <div style="background:#ffffff;border:1px solid #dbeafe;border-top:none;border-radius:0 0 18px 18px;padding:24px 20px;box-shadow:0 18px 45px rgba(15,23,42,0.08);">
          <p style="margin:0 0 18px;font-size:15px;font-weight:bold;color:#0f172a;">A new <span style="color:#1d4ed8;">Quarter Application Window</span> is now open.</p>
          <div style="margin:0 0 16px;padding:14px 16px;border-left:4px solid #2563eb;background:#eff6ff;border-radius:10px;color:#1e3a8a;font-size:14px;font-weight:600;">
            Quarter Types: ${escapeHtml(qtyStr)}<br/>
            Application window: ${escapeHtml(from)} to ${escapeHtml(to)}
          </div>
          <p style="margin:0 0 18px;font-size:14px;color:#0f172a;">Please find the <strong>official circular</strong> attached to this email for complete details and guidelines.</p>
          <p style="margin:20px 0 0;color:#64748b;font-size:12px;">This is an automated message from the LMS Quarters portal. Please do not reply to this email.</p>
        </div>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from: env("MAIL_FROM", env("MAIL_USER")),
    bcc: emails.join(", "),
    subject,
    text: textLines,
    html,
    attachments: [
      {
        filename: "Logo.png",
        path: LOGO_PATH,
        cid: "ppa-logo",
      },
      {
        filename: `Circular_${new Date().toISOString().slice(0, 10)}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  });

  return { recipients: emails.length };
}

module.exports = {
  sendQuarterApprovalEmail,
  sendCircularEmail,
  sendCircularEmailWithBuffer,
};
