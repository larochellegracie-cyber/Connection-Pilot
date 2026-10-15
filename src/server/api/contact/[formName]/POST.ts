/**
 * Emails contact form submissions to the support inbox.
 * Config values are read from contact-form.config.json (map of form entries,
 * each with the recipient address). Sending goes through src/server/email.ts.
 */
import type { Request, Response } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { sendEmail } from "@/server/email";

interface ContactFormEntry {
	/** Address that receives submissions for this form. */
	to: string;
}

interface ContactFormConfig {
	forms: Record<string, ContactFormEntry>;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function loadConfig(): ContactFormConfig {
	// publish (dist-only): cwd = /app/dist → contact-form.config.json
	// dev (preview):        cwd = /app     → src/lib/contact-form.config.json
	const candidates = [
		join(process.cwd(), "contact-form.config.json"),
		join(process.cwd(), "src/lib/contact-form.config.json"),
	];
	for (const p of candidates) {
		try {
			return JSON.parse(readFileSync(p, "utf-8")) as ContactFormConfig;
		} catch (err: unknown) {
			// Only skip missing-file errors; surface anything unexpected
			const code = (err as NodeJS.ErrnoException).code;
			if (code !== "ENOENT") {
				console.error("[contact] config read error at", p, err);
			}
		}
	}
	throw new Error("contact-form.config.json not found");
}

const SIMPLE_EMAIL = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function singleLine(value: unknown, max: number): string {
	return String(value ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, max);
}

function getConfig(): ContactFormConfig | null {
	try {
		return loadConfig();
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// IP rate limiting — 5 requests per 60 seconds per visitor IP
// In-memory per process: resets on restart, does not protect across instances.
// ---------------------------------------------------------------------------

interface RateBucket {
	count: number;
	resetAt: number;
}

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;
const rateBuckets = new Map<string, RateBucket>();

// Prune expired buckets periodically so the Map doesn't grow unbounded.
setInterval(() => {
	const now = Date.now();
	for (const [ip, bucket] of rateBuckets) {
		if (now > bucket.resetAt) rateBuckets.delete(ip);
	}
}, RATE_WINDOW_MS);

function isRateLimited(ip: string): boolean {
	const now = Date.now();
	const bucket = rateBuckets.get(ip);

	if (!bucket || now > bucket.resetAt) {
		rateBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
		return false;
	}

	if (bucket.count >= RATE_LIMIT) return true;

	bucket.count++;
	return false;
}

// ---------------------------------------------------------------------------
// Visitor IP
// dev-supervisor is always fronted by Cloudflare; the real client IP is in
// Cf-Connecting-Ip. Fall back to X-Forwarded-For (first entry), then socket.
// Never use req.socket.remoteAddress alone — that's the dev-supervisor proxy.
// ---------------------------------------------------------------------------

function getVisitorIp(req: Request): string {
	const cfIp = req.headers["cf-connecting-ip"];
	if (typeof cfIp === "string" && cfIp.trim()) return cfIp.trim();

	const xff = req.headers["x-forwarded-for"];
	if (typeof xff === "string" && xff.trim()) {
		return xff.split(",")[0]?.trim() ?? "";
	}

	return req.socket?.remoteAddress ?? req.ip ?? "unknown";
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async function handler(req: Request, res: Response): Promise<void> {
	const formName = req.params.formName as string;
	const body = req.body;

	const visitorIp = getVisitorIp(req);

	// Honeypot — bots fill hidden fields; real users never do
	if (body?._gotcha) {
		console.warn("[contact] honeypot triggered", { ip: visitorIp });
		res.status(200).json({ success: true });
		return;
	}

	// Input validation — require at least one visitor identifier
	const email = body?.user?.email;
	const mobile = body?.user?.mobile;
	if (!email && !mobile) {
		res.status(400).json({ success: false, error: "user.email or user.mobile is required" });
		return;
	}

	const messageBody = body?.conversation?.messages_attributes?.[0]?.body;
	if (!messageBody) {
		res.status(400).json({ success: false, error: "conversation message body is required" });
		return;
	}

	const config = getConfig();
	if (!config?.forms) {
		res.status(500).json({ success: false, error: "Contact form not configured" });
		return;
	}

	const formConfig = Object.hasOwn(config.forms, formName) ? config.forms[formName] : undefined;
	if (!formConfig) {
		res.status(404).json({ success: false, error: `Form "${formName}" not configured` });
		return;
	}

	// IP rate limiting
	if (isRateLimited(visitorIp)) {
		console.warn("[contact] rate limit hit", { ip: visitorIp });
		res.status(429).json({ success: false, error: "Too many requests" });
		return;
	}

	// Build the support email. Visitor-supplied text is escaped in the HTML body
	// and flattened to one line anywhere it could end up in a header.
	const visitorName = singleLine(body.user?.name, 200) || "Website visitor";
	const visitorEmail = singleLine(email, 320);
	const visitorMobile = singleLine(mobile, 50);
	const fields: Array<[string, string]> = [["Name", visitorName]];
	if (visitorEmail) fields.push(["Email", visitorEmail]);
	if (visitorMobile) fields.push(["Mobile", visitorMobile]);
	const extra = body.conversation?.data;
	if (extra && typeof extra === "object") {
		for (const [label, value] of Object.entries(extra as Record<string, unknown>)) {
			if (label.startsWith("__gd_")) continue;
			fields.push([singleLine(label, 100), singleLine(value, 500)]);
		}
	}
	const message = String(messageBody).slice(0, 5000);

	const text = [
		...fields.map(([label, value]) => `${label}: ${value}`),
		"",
		"Message:",
		message,
	].join("\n");
	const html =
		`<table>${fields
			.map(([label, value]) => `<tr><th align="left">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
			.join("")}</table>` +
		`<h3>Message</h3><p style="white-space:pre-wrap">${escapeHtml(message)}</p>`;

	try {
		await sendEmail({
			fromName: "Connection Pilot Website",
			to: formConfig.to,
			subject: `New contact form message (${singleLine(formName, 100)}) from ${visitorName}`,
			text,
			html,
			...(SIMPLE_EMAIL.test(visitorEmail) && { replyTo: visitorEmail }),
		});
		res.status(200).json({ success: true });
	} catch (err: unknown) {
		const reason = err instanceof Error ? err.message : String(err);
		console.error("[contact] email error:", reason);
		res.status(502).json({ success: false, error: "Failed to submit contact form" });
	}
}
