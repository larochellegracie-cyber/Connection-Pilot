/**
 * Send transactional email through Resend (https://resend.com).
 *
 * Configuration (environment variables / .env):
 * - RESEND_API_KEY: Resend API key. When missing outside production, emails are
 *   printed to the terminal instead of being sent (local development mode).
 *   In production a missing key is an error so nothing is silently "sent".
 * - EMAIL_FROM: sender address on a domain verified in Resend
 *   (default: noreply@connectionpilot.net).
 */
import { randomUUID } from "node:crypto";

import { getSecret } from "#airo/secrets";

const RESEND_API_URL = "https://api.resend.com/emails";
const DEFAULT_FROM_ADDRESS = "noreply@connectionpilot.net";
const REQUEST_TIMEOUT_MS = 30_000;

export type EmailAttachment = {
	/** File name presented to the recipient. Must not contain CR, LF, quote, or backslash. */
	filename: string;
	/**
	 * Attachment bytes. Always pass raw bytes — the helper base64-encodes
	 * for the wire. For text content (e.g. an .ics calendar invite),
	 * encode the string yourself: `Buffer.from(text, 'utf-8')`.
	 */
	content: Buffer | Uint8Array;
	/** MIME type. Defaults to application/octet-stream when omitted. */
	contentType?: string;
};

export type SendEmailInput = {
	/** Recipient address(es). At least one required. */
	to: string | string[];
	/** Carbon-copy recipient(s). */
	cc?: string | string[];
	/** Blind-carbon-copy recipient(s). Never appears in headers. */
	bcc?: string | string[];
	/** Subject line. Required. */
	subject: string;
	/** Plain-text body. At least one of text or html is required. */
	text?: string;
	/** HTML body. At least one of text or html is required. */
	html?: string;
	/** Reply-To header. Use this to direct replies elsewhere. */
	replyTo?: string;
	/**
	 * Sender address. Omit to use EMAIL_FROM. Must be on a domain verified in
	 * Resend, otherwise Resend rejects the message.
	 */
	from?: string;
	/**
	 * Display name shown in the recipient's inbox (e.g. "Acme Bakery").
	 * Combined with the sender address to produce an RFC 5322
	 * From header like: "Acme Bakery" <sender@domain>.
	 */
	fromName?: string;
	/** Up to 10 attachments, each ≤ 2 MB decoded. */
	attachments?: EmailAttachment[];
};

export type SendEmailResult = {
	/** Message id from Resend (or a `local-` id when printed to the terminal). */
	messageId: string;
	/** True only when the email provider accepted the message. False means it was just printed to the terminal. */
	delivered: boolean;
};

/** Removes anything that looks like a Resend key (and the configured key itself) from text that may be logged or shown. */
export function redactSecrets(text: string): string {
	let safe = text.replace(/\bre_[A-Za-z0-9_-]{6,}/g, "[redacted]");
	const configured = getSecret("RESEND_API_KEY");
	if (typeof configured === "string" && configured.length >= 6) safe = safe.split(configured).join("[redacted]");
	return safe;
}

/** Raised when email cannot be sent because the email service has not been configured. */
export class EmailNotConfiguredError extends Error {
	constructor(message = "email not configured: RESEND_API_KEY is not set") {
		super(message);
		this.name = "EmailNotConfiguredError";
	}
}

type ResendPayload = {
	from: string;
	to: string[];
	subject: string;
	cc?: string[];
	bcc?: string[];
	text?: string;
	html?: string;
	reply_to?: string;
	attachments?: { filename: string; content: string; content_type?: string }[];
};

type ResendResponse = {
	id?: string;
	message?: string;
	name?: string;
};

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
	const payload = buildPayload(input);
	const apiKey = getSecret("RESEND_API_KEY");

	if (!apiKey || typeof apiKey !== "string") {
		if (process.env.NODE_ENV === "production") {
			throw new EmailNotConfiguredError();
		}
		return logEmailToTerminal(payload);
	}

	// AbortSignal.timeout() binds to the response so the same deadline
	// covers connect, headers, AND body reads.
	let response: Response;
	let body: ResendResponse;
	try {
		response = await fetch(RESEND_API_URL, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		body = await parseBody(response);
	} catch (err) {
		throw new Error(`email provider unreachable: ${redactSecrets(describeError(err))}`);
	}

	if (!response.ok) {
		const detail = redactSecrets(body.message ?? `HTTP ${response.status}`);
		throw new Error(`email send failed: ${detail}`);
	}

	if (!body.id) {
		throw new Error("email send succeeded but provider returned no message id");
	}

	return { messageId: body.id, delivered: true };
}

/**
 * Like sendEmail, but never pretends: if the message was only printed to the terminal
 * (no RESEND_API_KEY in development) it throws EmailNotConfiguredError. Use this wherever a
 * screen tells the owner an email was sent (schedules, quotes, invoices, support mail).
 * Password-reset and similar developer-visible mail can keep using sendEmail.
 */
export async function sendEmailOrThrow(input: SendEmailInput): Promise<SendEmailResult> {
	const result = await sendEmail(input);
	if (!result.delivered) {
		throw new EmailNotConfiguredError("email not configured: RESEND_API_KEY is not set (the message was printed to the terminal, not sent)");
	}
	return result;
}

/** Turns a send error into an HTTP status and a message that is safe to show the owner. */
export function emailFailure(error: unknown): { status: number; error: string; setupRequired?: true } {
	if (error instanceof EmailNotConfiguredError) {
		return { status: 503, setupRequired: true, error: "Email isn’t set up yet, so nothing was sent. Add RESEND_API_KEY and EMAIL_FROM to this app’s settings." };
	}
	const reason = error instanceof Error ? redactSecrets(error.message).replace(/^email send failed:\s*/i, "").slice(0, 160) : "";
	return { status: 502, error: reason ? `The email service could not send this message: ${reason}` : "The email service could not send this message. Please try again." };
}

function logEmailToTerminal(payload: ResendPayload): SendEmailResult {
	const messageId = `local-${randomUUID()}`;
	const lines = [
		"",
		"----- EMAIL (not sent: RESEND_API_KEY is not set) -----",
		`Message id: ${messageId}`,
		`From:       ${payload.from}`,
		`To:         ${payload.to.join(", ")}`,
		...(payload.cc ? [`Cc:         ${payload.cc.join(", ")}`] : []),
		...(payload.bcc ? [`Bcc:        ${payload.bcc.join(", ")}`] : []),
		...(payload.reply_to ? [`Reply-To:   ${payload.reply_to}`] : []),
		`Subject:    ${payload.subject}`,
		...(payload.attachments
			? [`Attachments: ${payload.attachments.map((a) => a.filename).join(", ")}`]
			: []),
		"",
		payload.text ?? "(no plain-text body; HTML only)",
		"-------------------------------------------------------",
		"",
	];
	console.info(lines.join("\n"));
	return { messageId, delivered: false };
}

function buildPayload(input: SendEmailInput): ResendPayload {
	const to = toArray(input.to);
	if (to.length === 0) throw new Error("email requires at least one recipient");
	if (!input.text && !input.html) throw new Error("email requires a text or html body");

	const fromAddress = input.from ?? resolveFromAddress();
	const payload: ResendPayload = {
		from: input.fromName ? `${formatDisplayName(input.fromName)} <${fromAddress}>` : fromAddress,
		to,
		subject: input.subject,
	};
	const cc = toArray(input.cc);
	if (cc.length > 0) payload.cc = cc;
	const bcc = toArray(input.bcc);
	if (bcc.length > 0) payload.bcc = bcc;
	if (input.text) payload.text = input.text;
	if (input.html) payload.html = input.html;
	if (input.replyTo) payload.reply_to = input.replyTo;
	if (input.attachments && input.attachments.length > 0) {
		payload.attachments = input.attachments.map(encodeAttachment);
	}
	return payload;
}

function resolveFromAddress(): string {
	const configured = getSecret("EMAIL_FROM");
	return typeof configured === "string" && configured.trim() ? configured.trim() : DEFAULT_FROM_ADDRESS;
}

/** Quote the display name and strip characters that could break or inject headers. */
function formatDisplayName(name: string): string {
	const cleaned = name.replace(/[\r\n"\\<>]/g, " ").replace(/\s+/g, " ").trim();
	return `"${cleaned}"`;
}

function toArray(value: string | string[] | undefined): string[] {
	if (value === undefined) return [];
	return Array.isArray(value) ? value : [value];
}

function encodeAttachment(att: EmailAttachment): { filename: string; content: string; content_type?: string } {
	const out: { filename: string; content: string; content_type?: string } = {
		filename: att.filename,
		content: Buffer.from(att.content).toString("base64"),
	};
	if (att.contentType) out.content_type = att.contentType;
	return out;
}

async function parseBody(response: Response): Promise<ResendResponse> {
	try {
		return (await response.json()) as ResendResponse;
	} catch (err) {
		// Don't swallow aborts — re-raise so the outer catch reports the
		// timeout. JSON parse errors fall through to a sanitized payload.
		if (isAbortLike(err)) throw err;
		return { message: `non-JSON response (HTTP ${response.status})` };
	}
}

function isAbortLike(err: unknown): boolean {
	return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}

function describeError(err: unknown): string {
	if (err instanceof Error) {
		if (isAbortLike(err)) return `timed out after ${REQUEST_TIMEOUT_MS}ms`;
		return err.message;
	}
	return String(err);
}
