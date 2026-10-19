import { connect } from "cloudflare:sockets";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const SMTP_TIMEOUT_MS = 15000;

export function validateSmtpHost(value) {
  const host = String(value || "").trim().toLowerCase().replace(/\.$/, "");
  if (!host || host.length > 253) clientSmtpHostError();
  if (/[^a-z0-9.:-]/i.test(host) || host.includes("/") || host.includes("\\") || host.includes("@")) clientSmtpHostError();


  if (isIPv4(host)) {
    const parts = host.split(".").map(Number);
    const [a,b,c,d] = parts;
    const blocked = a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      (a === 192 && b === 0 && c === 2);
    if (blocked) clientSmtpHostError();
    return host;
  }

  if (isIPv6(host)) {
    const packed = parseIPv6(host);
    const first = packed[0];
    const isUnspecified = packed.every(part => part === 0);
    const isLoopback = isUnspecified ? false : packed.slice(0, 7).every(part => part === 0) && packed[7] === 1;
    const privateOrReserved = (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00 || first === 0x2001 && packed[1] === 0x0db8;
    if (isUnspecified || isLoopback || privateOrReserved) clientSmtpHostError();
    return host;
  }

  const labels = host.split(".");
  if (labels.length < 2 || labels.some(label => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))) clientSmtpHostError();
  if (["localhost", "metadata.google.internal", "metadata.google", "instance-data.ec2.internal"].includes(host) || /\.(local|internal|lan|home|localhost)$/.test(host)) clientSmtpHostError();
  return host;
}


async function openSmtpSocket(host, port, security) {
  const socket = connect(
    { hostname: host, port },
    security === "ssl"
      ? { secureTransport: "on", allowHalfOpen: false }
      : { secureTransport: "starttls", allowHalfOpen: false }
  );

  // Cloudflare resolves `opened` with SocketInfo, which contains the actual
  // peer address. The Socket itself does not expose `remoteAddress` directly.
  const socketInfo = await withTimeout(socket.opened, "SMTP connection timed out.");

  // Hostname validation alone is not enough: a public hostname can resolve
  // to a private/reserved address (including through DNS rebinding). Inspect
  // the address Cloudflare actually connected to before speaking SMTP.
  const remoteAddress = socketInfo?.remoteAddress;
  if (!remoteAddress || !isPublicIpAddress(remoteAddress)) {
    try { socket.close(); } catch {}
    const error = new Error("SMTP host resolved to a private or reserved network address.");
    error.status = 400;
    throw error;
  }

  return socket;
}

function isPublicIpAddress(value) {
  const ip = String(value || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (isIPv4(ip)) {
    const [a,b,c,d] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 0 || b === 168)) return false;
    if (a === 192 && b === 0 && c === 0) return false;
    if (a === 192 && b === 88 && c === 99) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a === 198 && b === 51 && c === 100) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }

  if (!isIPv6(ip)) return false;
  const packed = parseIPv6(ip);
  const first = packed[0];
  const isUnspecified = packed.every(part => part === 0);
  const isLoopback = packed.slice(0, 7).every(part => part === 0) && packed[7] === 1;
  if (isUnspecified || isLoopback) return false;
  if ((first & 0xfe00) === 0xfc00) return false; // ULA
  if ((first & 0xffc0) === 0xfe80) return false; // link-local
  if ((first & 0xff00) === 0xff00) return false; // multicast
  if (first === 0x2001 && packed[1] === 0x0db8) return false; // documentation
  if (first === 0x0064 && packed[1] === 0xff9b) return false; // 64:ff9b::/96 NAT64

  // IPv4-mapped / compatible IPv6 addresses must also pass the IPv4 rules.
  const mapped = packed.slice(0, 6).every(part => part === 0) && (packed[5] === 0 || packed[5] === 0xffff);
  if (mapped) {
    const a = (packed[6] >> 8) & 255, b = packed[6] & 255;
    const c = (packed[7] >> 8) & 255, d = packed[7] & 255;
    return isPublicIpAddress(`${a}.${b}.${c}.${d}`);
  }
  return true;
}


function clientSmtpHostError() {
  const error = new Error("SMTP host must be a public SMTP hostname or public IP address.");
  error.status = 400;
  throw error;
}

function isIPv4(host) {
  const parts = host.split(".");
  return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function isIPv6(host) {
  return host.includes(":") && /^[0-9a-f:]+$/i.test(host);
}

function parseIPv6(host) {
  const [leftRaw, rightRaw] = host.split("::");
  if (host.indexOf("::") !== host.lastIndexOf("::")) clientSmtpHostError();
  const left = leftRaw ? leftRaw.split(":").filter(Boolean) : [];
  const right = rightRaw ? rightRaw.split(":").filter(Boolean) : [];
  if (left.some(group => !/^[0-9a-f]{1,4}$/i.test(group)) || right.some(group => !/^[0-9a-f]{1,4}$/i.test(group))) clientSmtpHostError();
  if (!host.includes("::") && left.length !== 8) clientSmtpHostError();
  const missing = 8 - left.length - right.length;
  if (missing < 1) clientSmtpHostError();
  return [...left.map(v => parseInt(v, 16)), ...Array(missing).fill(0), ...right.map(v => parseInt(v, 16))];
}

export async function verifySmtpSender({ host, port, security, user, password, fromEmail, ehloName }) {
  validateSmtpHost(host);
  const sender = String(fromEmail || "").trim();
  if (!sender) return { compatible: true, skipped: true };

  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(sender)) {
    const error = new Error("Custom From email must be a valid email address.");
    error.status = 400;
    throw error;
  }

  const normalizedUser = String(user || "").trim().toLowerCase();
  if (sender.toLowerCase() === normalizedUser) {
    return { compatible: true, skipped: true };
  }

  let socket;
  let client;
  let stage = "connecting";

  try {
    socket = await openSmtpSocket(host, port, security);

    stage = "SMTP greeting";
    client = new SmtpClient(socket);
    await withTimeout(client.expectCode(220), "SMTP greeting timed out.");

    stage = "EHLO";
    let capabilities = await withTimeout(client.ehlo(ehloName), "SMTP EHLO timed out.");

    if (security !== "ssl" && security === "starttls") {
      if (!capabilities.has("STARTTLS")) {
        throw smtpError(530, "SMTP_SECURITY is set to starttls, but the server does not advertise STARTTLS.");
      }

      stage = "STARTTLS";
      await withTimeout(client.command("STARTTLS", [220]), "SMTP STARTTLS command timed out.");
      client.release();
      const tlsSocket = socket.startTls();
      await withTimeout(tlsSocket.opened, "SMTP TLS handshake timed out.");

      socket = tlsSocket;
      stage = "EHLO after STARTTLS";
      client = new SmtpClient(socket);
      capabilities = await withTimeout(client.ehlo(ehloName), "SMTP EHLO timed out.");
    }

    stage = "SMTP authentication";
    await withTimeout(authenticate(client, capabilities, user, password), "SMTP authentication timed out.");

    stage = "custom From compatibility check";
    const response = await withTimeout(client.command(`MAIL FROM:<${sanitizeAddress(sender)}>`, [250, 530, 550, 551, 553, 554]), "SMTP sender check timed out.");
    if (response.code !== 250) {
      throw smtpError(
        response.code,
        response.message || `The SMTP server does not permit ${sender} as a sender for the authenticated account.`
      );
    }

    // Reset the transaction without sending a message.
    await withTimeout(client.command("RSET", [250]).catch(() => {}), "SMTP reset timed out.");
    await withTimeout(client.command("QUIT", [221, 250]).catch(() => {}), "SMTP quit timed out.");
    try { socket.close(); } catch {}

    return { compatible: true, skipped: false };
  } catch (error) {
    try { client?.release?.(); } catch {}
    try { socket?.close(); } catch {}

    if (error?.smtpCode) throw error;

    const wrapped = new Error(`${stage}: ${String(error?.message || error)}`);
    wrapped.status = error?.status || 502;
    wrapped.cause = error;
    throw wrapped;
  }
}

export async function sendSmtp({ host, port, security, user, password, fromEmail, envelopeFromEmail, fromName, ehloName, payload }) {
  validateSmtpHost(host);
  // Keep the visible From identity separate from the SMTP envelope sender.
  // Contact forms can display the visitor as From while the authenticated
  // mailbox remains responsible for the SMTP transaction. Providers may still
  // apply their own anti-spoofing / DMARC policy to the visible From address.
  const requestFrom = String(fromEmail || user || "").trim();
  const envelopeSender = String(envelopeFromEmail || user || requestFrom).trim();
  const requestFromName =
    payload?.name !== undefined && payload?.name !== null && String(payload.name).trim()
      ? String(payload.name).trim()
      : String(fromName || "").trim();

  if (!requestFrom || !/^[^\s@<>]+@[^\s@<>]+$/.test(requestFrom)) {
    const error = new Error("From email must be a valid email address.");
    error.status = 400;
    throw error;
  }
  if (!envelopeSender || !/^[^\s@<>]+@[^\s@<>]+$/.test(envelopeSender)) {
    const error = new Error("SMTP envelope sender must be a valid email address.");
    error.status = 400;
    throw error;
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP_PORT must be a valid TCP port.");
  }
  if (port === 25) {
    const error = new Error("SMTP port 25 is not available from Cloudflare Workers. Use a submission port such as 465, 587, or 2525.");
    error.status = 400;
    throw error;
  }

  if (security !== "ssl" && security !== "starttls") {
    const error = new Error("SMTP security must be SSL / TLS or STARTTLS.");
    error.status = 400;
    throw error;
  }

  const secure = security === "ssl";

  let socket;
  let client;
  let stage = "connecting";

  try {
    socket = await openSmtpSocket(host, port, security);

    stage = "SMTP greeting";
    client = new SmtpClient(socket);
    await withTimeout(client.expectCode(220), "SMTP greeting timed out.");

    stage = "EHLO";
    let capabilities = await withTimeout(client.ehlo(ehloName), "SMTP EHLO timed out.");

    if (!secure && security === "starttls") {
      if (!capabilities.has("STARTTLS")) {
        throw smtpError(530, "SMTP_SECURITY is set to starttls, but the server does not advertise STARTTLS.");
      }

      stage = "STARTTLS";
      await withTimeout(client.command("STARTTLS", [220]), "SMTP STARTTLS command timed out.");

      // Cloudflare requires the old socket readers/writers to be released
      // before switching to the new TLS socket.
      client.release();
      const tlsSocket = socket.startTls();
      await withTimeout(tlsSocket.opened, "SMTP TLS handshake timed out.");

      stage = "EHLO after STARTTLS";
      client = new SmtpClient(tlsSocket);
      capabilities = await withTimeout(client.ehlo(ehloName), "SMTP EHLO timed out.");
    }

    stage = "SMTP authentication";
    await withTimeout(authenticate(client, capabilities, user, password), "SMTP authentication timed out.");

    // `payload.to` is the normalized envelope recipient selected by the
    // send endpoint according to the authenticated API key and plan.
    const to = normalizeEmails(payload?.to, false);
    if (!to.length) to.push(...normalizeEmails(user, true));
    const cc = normalizeEmails(payload.cc, false);
    const bcc = normalizeEmails(payload.bcc, false);
    const recipients = [...to, ...cc, ...bcc];

    stage = "MAIL FROM";
    const mailFromResult = await withTimeout(sendMailFrom(client, envelopeSender), "SMTP sender command timed out.");

    stage = "RCPT TO";
    for (const recipient of recipients) {
      const response = await withTimeout(client.command(
        `RCPT TO:<${sanitizeAddress(recipient)}>`,
        [250, 251]
      ), "SMTP recipient command timed out.");
      if (response.code >= 400) {
        throw smtpError(response.code, response.message);
      }
    }

    stage = "DATA";
    await withTimeout(client.command("DATA", [354]), "SMTP DATA command timed out.");

    const messageId = `<${crypto.randomUUID()}@${messageDomain(envelopeSender, host)}>`;
    const rawMessage = buildMimeMessage({
      from: requestFrom,
      fromName: requestFromName,
      to,
      cc,
      replyTo: getReplyTo(payload),
      subject: payload.subject,
      message: payload.message || "",
      html: payload.html,
      messageId
    });

    stage = "message delivery";
    await withTimeout(client.writeData(rawMessage), "SMTP message upload timed out.");
    const accepted = await withTimeout(client.readResponse(), "SMTP message delivery timed out.");
    if (![250, 251].includes(accepted.code)) {
      throw smtpError(accepted.code, accepted.message);
    }

    await withTimeout(client.command("QUIT", [221, 250]).catch(() => {}), "SMTP quit timed out.");

    try { socket.close(); } catch {}
    return { messageId, envelopeFrom: mailFromResult.envelopeFrom, fallbackUsed: mailFromResult.fallbackUsed };
  } catch (error) {
    try { socket?.close(); } catch {}

    if (!error?.smtpCode) {
      const wrapped = new Error(`${stage}: ${String(error?.message || error)}`);
      wrapped.status = error?.status || 502;
      wrapped.cause = error;
      throw wrapped;
    }

    throw error;
  }
}

async function sendMailFrom(client, sender) {
  const envelopeFrom = sanitizeAddress(sender);
  const response = await client.command(`MAIL FROM:<${envelopeFrom}>`, [250, 530, 550, 551, 553, 554]);
  if (response.code === 250) return { envelopeFrom, fallbackUsed: false };
  throw smtpError(response.code, response.message);
}

async function authenticate(client, capabilities, user, password) {
  const authLine = capabilities.lines.find(line => /^AUTH\s+/i.test(line));
  const mechanisms = authLine
    ? authLine
        .replace(/^AUTH\s+/i, "")
        .trim()
        .toUpperCase()
        .split(/\s+/)
    : [];

  // Prefer PLAIN where advertised, otherwise LOGIN.
  if (mechanisms.includes("PLAIN")) {
    const token = base64FromString(`\0${user}\0${password}`);
    const response = await withTimeout(client.command(`AUTH PLAIN ${token}`, [235, 334]), "SMTP authentication timed out.");
    if (response.code === 334) {
      const finalResponse = await withTimeout(client.command(token, [235]), "SMTP authentication timed out.");
      if (finalResponse.code !== 235) {
        throw smtpError(finalResponse.code, finalResponse.message);
      }
    }
    return;
  }

  if (mechanisms.includes("LOGIN")) {
    await withTimeout(client.command("AUTH LOGIN", [334]), "SMTP authentication timed out.");
    await withTimeout(client.command(base64FromString(user), [334]), "SMTP authentication timed out.");
    await withTimeout(client.command(base64FromString(password), [235]), "SMTP authentication timed out.");
    return;
  }

  // Some SMTP servers omit AUTH from EHLO but still accept LOGIN.
  const response = await withTimeout(client.command("AUTH LOGIN", [334, 504, 530]), "SMTP authentication timed out.");
  if (response.code === 334) {
    await withTimeout(client.command(base64FromString(user), [334]), "SMTP authentication timed out.");
    await withTimeout(client.command(base64FromString(password), [235]), "SMTP authentication timed out.");
    return;
  }

  throw smtpError(
    504,
    "The SMTP server did not advertise a supported AUTH PLAIN or AUTH LOGIN mechanism."
  );
}


function getReplyTo(payload) {
  return normalizeEmails(payload?.replyTo, false)[0] || null;
}

function buildMimeMessage({
  from,
  fromName,
  to,
  cc,
  replyTo,
  subject,
  message,
  html,
  messageId
}) {
  const headers = [
    `From: ${formatAddress(from, fromName)}`,
    `To: ${to.map(sanitizeAddress).join(", ")}`,
    ...(cc.length ? [`Cc: ${cc.map(sanitizeAddress).join(", ")}`] : []),
    ...(replyTo ? [`Reply-To: ${sanitizeAddress(replyTo)}`] : []),
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0"
  ];

  if (html !== undefined) {
    const boundary = `mixed_${crypto.randomUUID().replace(/-/g, "")}`;

    return [
      ...headers,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      foldBase64(base64FromString(message)),
      "",
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      foldBase64(base64FromString(html)),
      "",
      `--${boundary}--`,
      ""
    ].join("\r\n");
  }

  return [
    ...headers,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    foldBase64(base64FromString(message)),
    ""
  ].join("\r\n");
}

function formatAddress(email, name) {
  const cleanEmail = sanitizeAddress(email);
  if (!name) return `<${cleanEmail}>`;

  // Use RFC 2047 for a UTF-8 display name.
  const cleanName = String(name).replace(/[\r\n"]/g, "");
  return `=?UTF-8?B?${base64FromString(cleanName)}?= <${cleanEmail}>`;
}

function encodeHeader(value) {
  const text = String(value).replace(/[\r\n]/g, " ").trim();

  // ASCII headers can be used directly after folding.
  if (/^[\x20-\x7E]*$/.test(text)) return foldHeader(text);

  return `=?UTF-8?B?${base64FromString(text)}?=`;
}

function foldHeader(value) {
  // Basic RFC 5322 line folding at a safe boundary.
  if (value.length <= 900) return value;
  const chunks = [];
  let current = "";

  for (const word of value.split(" ")) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > 800 && current) {
      chunks.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);

  return chunks.join("\r\n ");
}

function foldBase64(value) {
  return value.match(/.{1,76}/g)?.join("\r\n") || "";
}

function smtpError(code, message) {
  const error = new Error(
    message
      ? `SMTP ${code}: ${String(message).trim()}`
      : `SMTP server returned code ${code}.`
  );
  error.smtpCode = Number(code);
  error.smtpMessage = String(message || "");
  error.status = 502;
  return error;
}

export function normalizeEmails(value, required = true) {
  const input = Array.isArray(value) ? value : [value];
  const result = [];

  for (const item of input) {
    if (item === null || item === undefined) continue;

    const parts = String(item)
      .split(/[;,]/)
      .map(part => part.trim())
      .filter(Boolean);

    for (const part of parts) {
      const cleaned = sanitizeAddress(part).trim();
      if (!cleaned) continue;

      if (!/^[^\s@<>]+@[^\s@<>]+$/.test(cleaned)) {
        const error = new Error(`Invalid email address: ${cleaned}`);
        error.status = 400;
        throw error;
      }

      result.push(cleaned);
    }
  }

  const unique = [...new Set(result)];

  if (required && !unique.length) {
    const error = new Error("At least one recipient email address is required.");
    error.status = 400;
    throw error;
  }

  return unique;
}

function sanitizeAddress(value) {
  return String(value).replace(/[\r\n<>]/g, "");
}

function messageDomain(from, host) {
  const fromDomain = String(from).split("@")[1];
  const domain = fromDomain || String(host);
  return domain.replace(/[^a-zA-Z0-9.-]/g, "") || "localhost";
}

function base64FromString(value) {
  return base64FromBytes(encoder.encode(String(value)));
}

function base64FromBytes(bytes) {
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary);
}

class SmtpClient {
  constructor(socket) {
    this.socket = socket;
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
    this.text = "";
  }

  async ehlo(clientName) {
    await this.writeLine(`EHLO ${sanitizeEhloName(clientName)}`);
    const response = await this.readResponse();

    if (response.code !== 250) {
      throw smtpError(response.code, response.message);
    }

    const capabilities = new Set();

    for (const line of response.lines) {
      const value = line.replace(/^250[- ]?/, "").trim();
      const keyword = value.split(/\s+/)[0]?.toUpperCase();
      if (keyword) {
        capabilities.add(keyword);
      }
    }

    return {
      code: response.code,
      message: response.message,
      lines: response.lines,
      has: value => capabilities.has(value.toUpperCase())
    };
  }

  async command(command, expectedCodes) {
    await this.writeLine(command);
    const response = await this.readResponse();

    if (!expectedCodes.includes(response.code)) {
      throw smtpError(response.code, response.message);
    }

    return response;
  }

  async expectCode(expected) {
    const response = await this.readResponse();
    if (response.code !== expected) {
      throw smtpError(response.code, response.message);
    }
    return response;
  }

  release() {
    try { this.reader.releaseLock(); } catch {}
    try { this.writer.releaseLock(); } catch {}
  }

  async writeLine(line) {
    await withTimeout(this.writer.write(encoder.encode(`${line}\r\n`)), "SMTP write timed out.");
  }

  async writeData(data) {
    const normalized = normalizeBody(data);
    const stuffed = normalized
      .split("\r\n")
      .map(line => line.startsWith(".") ? `.${line}` : line)
      .join("\r\n");

    await withTimeout(this.writer.write(encoder.encode(`${stuffed}\r\n.\r\n`)), "SMTP message upload timed out.");
  }

  async readResponse() {
    const lines = [];

    while (true) {
      const line = await this.readLine();
      if (!line) continue;

      const match = line.match(/^(\d{3})([- ])(.*)$/);
      if (!match) {
        // Ignore non-standard greeting/banner lines until an SMTP response code arrives.
        continue;
      }

      const code = Number(match[1]);
      lines.push(line);

      if (match[2] === " ") {
        return {
          code,
          message: match[3].trim(),
          lines
        };
      }
    }
  }

  async readLine() {
    while (true) {
      const newline = this.text.indexOf("\r\n");
      if (newline >= 0) {
        const line = this.text.slice(0, newline);
        this.text = this.text.slice(newline + 2);
        return line;
      }

      const { value, done } = await withTimeout(this.reader.read(), "SMTP read timed out.");
      if (done) throw new Error("SMTP connection closed unexpectedly.");

      this.text += decoder.decode(value, { stream: true });

      if (this.text.length > 256 * 1024) {
        throw new Error("SMTP response is too large.");
      }
    }
  }
}

function normalizeBody(value) {
  return String(value).replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, "\r\n");
}

function sanitizeEhloName(value) {
  return String(value || "localhost")
    .replace(/[^a-zA-Z0-9.-]/g, "")
    .slice(0, 255) || "localhost";
}

function withTimeout(promise, message, ms = SMTP_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(message);
      error.code = "SMTP_TIMEOUT";
      error.status = 504;
      reject(error);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function resolveSmtpSecurity(value, port) {
  const configured = String(value || "").trim().toLowerCase();

  if (configured === "ssl" || configured === "tls") return "ssl";
  if (configured === "starttls") return "starttls";
  if (configured) {
    const error = new Error("SMTP_SECURITY must be one of: ssl or starttls.");
    error.status = 500;
    throw error;
  }

  // Common SMTP submission defaults.
  if (port === 465) return "ssl";
  if (port === 587 || port === 2525) return "starttls";

  // Other ports must explicitly select SSL / TLS or STARTTLS.
  const error = new Error("SMTP_SECURITY must be set to ssl or starttls.");
  error.status = 400;
  throw error;
}
