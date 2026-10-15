import express, { type Express, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { fileURLToPath } from "node:url";
import { dirname, extname, join } from "node:path";
import { readFileSync } from "node:fs";

import { createMediaAssetsMiddleware } from "../../export-plugins/media-assets-plugin";

// <api-imports>
import auth__action__get from "./api/auth/[action]/GET";
import auth__action__post from "./api/auth/[action]/POST";
import auth__action__detail__get from "./api/auth/[action]/[detail]/GET";
import auth__action__detail__post from "./api/auth/[action]/[detail]/POST";
import booking_rules__get from "./api/booking-rules/GET";
import booking_rules__put from "./api/booking-rules/PUT";
import business_knowledge__get from "./api/business-knowledge/GET";
import business_knowledge__put from "./api/business-knowledge/PUT";
import business_knowledge__preview__post from "./api/business-knowledge/preview/POST";
import business_profile__get from "./api/business-profile/GET";
import calendar__get from "./api/calendar/GET";
import calendar__post from "./api/calendar/POST";
import calendar__appointmentId__patch from "./api/calendar/[appointmentId]/PATCH";
import chat__post from "./api/chat/POST";
import connections__get from "./api/connections/GET";
import connections__provider__patch from "./api/connections/[provider]/PATCH";
import contact__formName__post from "./api/contact/[formName]/POST";
import customer_messaging__get from "./api/customer-messaging/GET";
import customer_messaging__patch from "./api/customer-messaging/PATCH";
import customers__get from "./api/customers/GET";
import customers__post from "./api/customers/POST";
import customers__customerId__delete from "./api/customers/[customerId]/DELETE";
import customers__customerId__get from "./api/customers/[customerId]/GET";
import customers__customerId__patch from "./api/customers/[customerId]/PATCH";
import customers__customerId__activity__post from "./api/customers/[customerId]/activity/POST";
import dashboard__get from "./api/dashboard/GET";
import dev__test_account__reset__post from "./api/dev/test-account/reset/POST";
import employee_portal__get from "./api/employee-portal/GET";
import employees__get from "./api/employees/GET";
import employees__post from "./api/employees/POST";
import employees__employeeId__patch from "./api/employees/[employeeId]/PATCH";
import finance__get from "./api/finance/GET";
import finance__post from "./api/finance/POST";
import finance__recordType__recordId__delete from "./api/finance/[recordType]/[recordId]/DELETE";
import finance__recordType__recordId__patch from "./api/finance/[recordType]/[recordId]/PATCH";
import finance__estimates__estimateId__send__post from "./api/finance/estimates/[estimateId]/send/POST";
import health__get from "./api/health/GET";
import jobs__get from "./api/jobs/GET";
import jobs__post from "./api/jobs/POST";
import jobs__jobId__delete from "./api/jobs/[jobId]/DELETE";
import jobs__jobId__patch from "./api/jobs/[jobId]/PATCH";
import leads__get from "./api/leads/GET";
import leads__post from "./api/leads/POST";
import leads__leadId__get from "./api/leads/[leadId]/GET";
import leads__leadId__patch from "./api/leads/[leadId]/PATCH";
import leads__leadId__activity__post from "./api/leads/[leadId]/activity/POST";
import leads__leadId__convert__post from "./api/leads/[leadId]/convert/POST";
import marketing__analyze__post from "./api/marketing/analyze/POST";
import marketing__profile__get from "./api/marketing/profile/GET";
import marketing__profile__put from "./api/marketing/profile/PUT";
import marketing__upload__post from "./api/marketing/upload/POST";
import messages__get from "./api/messages/GET";
import notifications__get from "./api/notifications/GET";
import notifications__notificationId__patch from "./api/notifications/[notificationId]/PATCH";
import onboarding__post from "./api/onboarding/POST";
import onboarding__preview__post from "./api/onboarding/preview/POST";
import phone_connection__get from "./api/phone-connection/GET";
import phone_connection__available__get from "./api/phone-connection/available/GET";
import phone_connection__connect__post from "./api/phone-connection/connect/POST";
import phone_connection__eligibility__post from "./api/phone-connection/eligibility/POST";
import phone_connection__port_request__post from "./api/phone-connection/port-request/POST";
import phone_connection__provision__post from "./api/phone-connection/provision/POST";
import pilot_documents__post from "./api/pilot-documents/POST";
import pilot_documents__documentId__confirm__post from "./api/pilot-documents/[documentId]/confirm/POST";
import pilot_learning__get from "./api/pilot-learning/GET";
import production_validation__post from "./api/production-validation/POST";
import receptionist__get from "./api/receptionist/GET";
import receptionist__put from "./api/receptionist/PUT";
import schedule_templates__get from "./api/schedule-templates/GET";
import schedule_templates__post from "./api/schedule-templates/POST";
import schedule_templates__templateId__apply__post from "./api/schedule-templates/[templateId]/apply/POST";
import schedules__get from "./api/schedules/GET";
import schedules__post from "./api/schedules/POST";
import schedules__copy_previous__post from "./api/schedules/copy-previous/POST";
import schedules__pilot_draft__post from "./api/schedules/pilot-draft/POST";
import schedules__scheduleId__patch from "./api/schedules/[scheduleId]/PATCH";
import schedules__scheduleId__email__post from "./api/schedules/[scheduleId]/email/POST";
import shifts__shiftId__delete from "./api/shifts/[shiftId]/DELETE";
import shifts__shiftId__patch from "./api/shifts/[shiftId]/PATCH";
import stripe__create_checkout_session__post from "./api/stripe/create-checkout-session/POST";
import stripe__customer_portal__post from "./api/stripe/customer-portal/POST";
import stripe__session__sessionId__get from "./api/stripe/session/[sessionId]/GET";
import stripe__test_reset__post from "./api/stripe/test-reset/POST";
import stripe__webhook__post from "./api/stripe/webhook/POST";
import subscription__get from "./api/subscription/GET";
import webhooks__twilio__post from "./api/webhooks/twilio/POST";
import webhooks__twilio__call_status__post from "./api/webhooks/twilio/call-status/POST";
import webhooks__twilio__recording__post from "./api/webhooks/twilio/recording/POST";
import webhooks__twilio__sms__post from "./api/webhooks/twilio/sms/POST";
import webhooks__twilio__transcript__post from "./api/webhooks/twilio/transcript/POST";
import webhooks__twilio__voice__post from "./api/webhooks/twilio/voice/POST";
// </api-imports>
import { seoRoutes } from "../lib/seo-routes";
import {
	loadAdSenseRuntimeConfig,
	resolveAdSenseTextFile,
	type AdSenseRuntimeConfig,
} from "./adsense-manifest";
import { loadIndexNowKey } from "./indexnow-key";
import { isSystemHost } from "./seo-host";
import { llmsTxtHandler } from "./llms-txt";

export interface SsrRenderResult {
	html: string;
	head: string;
	status: number;
	redirect?: string;
}

export function registerAdSenseTextRoutes(app: Express, config: AdSenseRuntimeConfig): void {
	app.get("/ads.txt", (_req, res) => {
		const content = resolveAdSenseTextFile(config, "adsTxt");
		if (content === null) {
			res
				.status(404)
				.type("text/plain")
				.set("Cache-Control", "no-cache")
				.send("Not found\n");
			return;
		}
		res.type("text/plain").set("Cache-Control", "no-cache").send(content);
	});

	app.get("/app-ads.txt", (_req, res) => {
		const content = resolveAdSenseTextFile(config, "appAdsTxt");
		if (content === null) {
			res
				.status(404)
				.type("text/plain")
				.set("Cache-Control", "no-cache")
				.send("Not found\n");
			return;
		}
		res.type("text/plain").set("Cache-Control", "no-cache").send(content);
	});
}

export function renderSsrDocument(
	template: string,
	result: Pick<SsrRenderResult, "head" | "html">,
	adSenseConfig: Pick<AdSenseRuntimeConfig, "scriptHtml">,
): string {
	const head = [result.head, adSenseConfig.scriptHtml].filter(Boolean).join("\n");
	return template
		.replace("<!--app-head-->", () => head)
		.replace("<!--app-html-->", () => result.html);
}

const app = express();

// Honour x-forwarded-* from the load balancer so req.protocol/req.hostname
// reflect the public-facing values. Express-maintained parsing respects the
// existing trust-proxy config; direct header reads would let a client spoof
// the sitemap origin in robots.txt.
app.set("trust proxy", true);

app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), stripe__webhook__post);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// <api-registrations>
app.get("/api/auth/:action", auth__action__get);
app.post("/api/auth/:action", auth__action__post);
app.get("/api/auth/:action/:detail", auth__action__detail__get);
app.post("/api/auth/:action/:detail", auth__action__detail__post);
app.get("/api/booking-rules", booking_rules__get);
app.put("/api/booking-rules", booking_rules__put);
app.get("/api/business-knowledge", business_knowledge__get);
app.put("/api/business-knowledge", business_knowledge__put);
app.post("/api/business-knowledge/preview", business_knowledge__preview__post);
app.get("/api/business-profile", business_profile__get);
app.get("/api/calendar", calendar__get);
app.post("/api/calendar", calendar__post);
app.patch("/api/calendar/:appointmentId", calendar__appointmentId__patch);
app.post("/api/chat", chat__post);
app.get("/api/connections", connections__get);
app.patch("/api/connections/:provider", connections__provider__patch);
app.post("/api/contact/:formName", contact__formName__post);
app.get("/api/customer-messaging", customer_messaging__get);
app.patch("/api/customer-messaging", customer_messaging__patch);
app.get("/api/customers", customers__get);
app.post("/api/customers", customers__post);
app.delete("/api/customers/:customerId", customers__customerId__delete);
app.get("/api/customers/:customerId", customers__customerId__get);
app.patch("/api/customers/:customerId", customers__customerId__patch);
app.post("/api/customers/:customerId/activity", customers__customerId__activity__post);
app.get("/api/dashboard", dashboard__get);
app.post("/api/dev/test-account/reset", dev__test_account__reset__post);
app.get("/api/employee-portal", employee_portal__get);
app.get("/api/employees", employees__get);
app.post("/api/employees", employees__post);
app.patch("/api/employees/:employeeId", employees__employeeId__patch);
app.get("/api/finance", finance__get);
app.post("/api/finance", finance__post);
app.delete("/api/finance/:recordType/:recordId", finance__recordType__recordId__delete);
app.patch("/api/finance/:recordType/:recordId", finance__recordType__recordId__patch);
app.post("/api/finance/estimates/:estimateId/send", finance__estimates__estimateId__send__post);
app.get("/api/health", health__get);
app.get("/api/jobs", jobs__get);
app.post("/api/jobs", jobs__post);
app.delete("/api/jobs/:jobId", jobs__jobId__delete);
app.patch("/api/jobs/:jobId", jobs__jobId__patch);
app.get("/api/leads", leads__get);
app.post("/api/leads", leads__post);
app.get("/api/leads/:leadId", leads__leadId__get);
app.patch("/api/leads/:leadId", leads__leadId__patch);
app.post("/api/leads/:leadId/activity", leads__leadId__activity__post);
app.post("/api/leads/:leadId/convert", leads__leadId__convert__post);
app.post("/api/marketing/analyze", marketing__analyze__post);
app.get("/api/marketing/profile", marketing__profile__get);
app.put("/api/marketing/profile", marketing__profile__put);
app.post("/api/marketing/upload", marketing__upload__post);
app.get("/api/messages", messages__get);
app.get("/api/notifications", notifications__get);
app.patch("/api/notifications/:notificationId", notifications__notificationId__patch);
app.post("/api/onboarding", onboarding__post);
app.post("/api/onboarding/preview", onboarding__preview__post);
app.get("/api/phone-connection", phone_connection__get);
app.get("/api/phone-connection/available", phone_connection__available__get);
app.post("/api/phone-connection/connect", phone_connection__connect__post);
app.post("/api/phone-connection/eligibility", phone_connection__eligibility__post);
app.post("/api/phone-connection/port-request", phone_connection__port_request__post);
app.post("/api/phone-connection/provision", phone_connection__provision__post);
app.post("/api/pilot-documents", pilot_documents__post);
app.post("/api/pilot-documents/:documentId/confirm", pilot_documents__documentId__confirm__post);
app.get("/api/pilot-learning", pilot_learning__get);
app.post("/api/production-validation", production_validation__post);
app.get("/api/receptionist", receptionist__get);
app.put("/api/receptionist", receptionist__put);
app.get("/api/schedule-templates", schedule_templates__get);
app.post("/api/schedule-templates", schedule_templates__post);
app.post("/api/schedule-templates/:templateId/apply", schedule_templates__templateId__apply__post);
app.get("/api/schedules", schedules__get);
app.post("/api/schedules", schedules__post);
app.post("/api/schedules/copy-previous", schedules__copy_previous__post);
app.post("/api/schedules/pilot-draft", schedules__pilot_draft__post);
app.patch("/api/schedules/:scheduleId", schedules__scheduleId__patch);
app.post("/api/schedules/:scheduleId/email", schedules__scheduleId__email__post);
app.delete("/api/shifts/:shiftId", shifts__shiftId__delete);
app.patch("/api/shifts/:shiftId", shifts__shiftId__patch);
app.post("/api/stripe/create-checkout-session", stripe__create_checkout_session__post);
app.post("/api/stripe/customer-portal", stripe__customer_portal__post);
app.get("/api/stripe/session/:sessionId", stripe__session__sessionId__get);
app.post("/api/stripe/test-reset", stripe__test_reset__post);
app.post("/api/stripe/webhook", stripe__webhook__post);
app.get("/api/subscription", subscription__get);
app.post("/api/webhooks/twilio", webhooks__twilio__post);
app.post("/api/webhooks/twilio/call-status", webhooks__twilio__call_status__post);
app.post("/api/webhooks/twilio/recording", webhooks__twilio__recording__post);
app.post("/api/webhooks/twilio/sms", webhooks__twilio__sms__post);
app.post("/api/webhooks/twilio/transcript", webhooks__twilio__transcript__post);
app.post("/api/webhooks/twilio/voice", webhooks__twilio__voice__post);
// </api-registrations>

// Error middleware must be registered AFTER the routes it protects; Express
// only passes errors to middleware defined later in the stack.
app.use("/api", (err: unknown, req: Request, res: Response, _next: NextFunction) => {
	// Always respond JSON on /api so clients parsing response.json() don't
	// receive Express's default HTML error page for non-Error throws.
	const requestError = err as { status?: number; type?: string };
	const status = requestError.status === 413 ? 413 : 500;
	console.error("ssr.api.error", {
		url: req.url,
		error: err instanceof Error ? err.stack : String(err),
		status,
		contentLength: req.headers['content-length'] ?? 'unknown',
		contentType: req.headers['content-type'] ?? 'unknown',
		parserErrorType: requestError.type ?? 'unknown',
	});
	res.status(status).json({ error: status === 413 ? "This upload is too large. Choose a file smaller than 5 MB." : "Internal server error" });
});

function baseUrl(req: Request): string {
	return `${req.protocol}://${req.hostname}`;
}

function escapeXml(s: string): string {
	return s.replace(/[&<>"']/g, (c) =>
		({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!,
	);
}

app.get("/robots.txt", (req, res) => {
	if (isSystemHost(req)) {
		res
			.type("text/plain")
			.set("Cache-Control", "public, max-age=60, must-revalidate").set("Vary", "Host")
			.send("User-agent: *\nDisallow: /\n");
		return;
	}
	const base = baseUrl(req);
	const body = [
		"User-agent: *",
		"Allow: /",
		"",
		`Sitemap: ${base}/sitemap.xml`,
		"",
	].join("\n");
	res.type("text/plain").set("Cache-Control", "public, max-age=60, must-revalidate").set("Vary", "Host").send(body);
});

app.get("/sitemap.xml", (req, res) => {
	if (isSystemHost(req)) {
		const empty = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>\n`;
		res.type("application/xml").set("Cache-Control", "public, max-age=60, must-revalidate").set("Vary", "Host").send(empty);
		return;
	}
	const base = baseUrl(req);
	const publicMarketingPaths = new Set([
		"/",
		"/solutions",
		"/how-it-works",
		"/features",
		"/pricing",
		"/about",
		"/pilot",
		"/ai-receptionist",
		"/customer-management",
		"/faqs",
		"/contact",
	]);
	const urls = seoRoutes
		.filter((r) => typeof r.path === "string" && publicMarketingPaths.has(r.path))
		.map((r) => {
			const loc = `${base}${r.path}`;
			const parts = [`    <loc>${escapeXml(loc)}</loc>`];
			if (r.lastmod) parts.push(`    <lastmod>${escapeXml(r.lastmod)}</lastmod>`);
			if (r.changefreq) parts.push(`    <changefreq>${r.changefreq}</changefreq>`);
			if (r.priority !== undefined)
				parts.push(`    <priority>${r.priority.toFixed(1)}</priority>`);
			return `  <url>\n${parts.join("\n")}\n  </url>`;
		})
		.join("\n");
	const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
	res.type("application/xml").set("Cache-Control", "public, max-age=60, must-revalidate").set("Vary", "Host").send(body);
});

app.get("/llms.txt", llmsTxtHandler);

if (import.meta.env.PROD) {
	const __dirname = dirname(fileURLToPath(import.meta.url));
	const clientDir = join(__dirname, "client");
	const adSenseRuntimeConfig = loadAdSenseRuntimeConfig(__dirname);
	const indexNowKey = loadIndexNowKey(__dirname);

	registerAdSenseTextRoutes(app, adSenseRuntimeConfig);

	if (indexNowKey !== null) {
		app.get(`/${indexNowKey}.txt`, (_req, res) => {
			res.type("text/plain").set("Cache-Control", "public, max-age=86400").send(indexNowKey);
		});
	}

	// Serve /airo-assets/* (logo, hero and other media slots) from the project's
	// public/ files and airo-media.json; dist/ sits one level below the project root.
	app.use(createMediaAssetsMiddleware(() => join(__dirname, "..")));

	app.use(
		express.static(clientDir, {
			index: false,
			setHeaders(res, filePath) {
				res.set(
					"Cache-Control",
					filePath.includes("/assets/")
						? "public, max-age=31536000, immutable"
						: "no-cache",
				);
			},
		}),
	);

	app.use((_req, res, next) => {
		res.set("Cache-Control", "no-cache");
		next();
	});

	let template: string;
	try {
		template = readFileSync(join(clientDir, "index.html"), "utf-8");
	} catch (err) {
		console.error("ssr.template.load-failed", {
			path: join(clientDir, "index.html"),
			error: err instanceof Error ? err.message : String(err),
		});
		process.exit(1);
	}
	if (!template.includes("<!--app-head-->") || !template.includes("<!--app-html-->")) {
		// Fail fast at boot, same as a template load failure above: without
		// markers, every .replace() call on the render path is a no-op and we
		// would serve a shell with no <head> content and no rendered body on
		// every request. Preferring process.exit over a degraded mode ensures
		// an operator notices and fixes the build rather than serving broken
		// SEO-invisible pages indefinitely.
		console.error("ssr.template.markers-missing", {
			hasHead: template.includes("<!--app-head-->"),
			hasHtml: template.includes("<!--app-html-->"),
		});
		process.exit(1);
	}
	const fallbackShell = template
		.replace("<!--app-head-->", "")
		.replace("<!--app-html-->", "");

	// Resolve the SSR module once into a stable render function. A failed
	// load is unrecoverable at runtime - exiting lets the container
	// scheduler restart with a clean slate rather than leaving the server
	// to serve silent 503s indefinitely against a single startup log.
	let renderFn: ((url: string, siteOrigin?: string) => Promise<SsrRenderResult>) | null = null;
	const SSR_MODULE_LOAD_TIMEOUT_MS = 30_000;
	const loadTimeout = setTimeout(() => {
		if (renderFn !== null) return;
		console.error("ssr.module.load-timeout", {
			timeoutMs: SSR_MODULE_LOAD_TIMEOUT_MS,
		});
		process.exit(1);
	}, SSR_MODULE_LOAD_TIMEOUT_MS);
	loadTimeout.unref();
	import("../entry-server").then(
		(mod) => {
			clearTimeout(loadTimeout);
			renderFn = mod.render;
		},
		(err) => {
			clearTimeout(loadTimeout);
			console.error("ssr.module.load-failed", {
				error: err instanceof Error ? err.stack : String(err),
			});
			process.exit(1);
		},
	);

	app.get(/.*/, async (req, res, next) => {
		if (req.method !== "GET") return next();
		if (req.path.startsWith("/api")) return next();
		if (extname(req.path)) return next();
		const sendFallback = () =>
			res
				.status(503)
				.set("Content-Type", "text/html; charset=utf-8")
				.set("Cache-Control", "no-store")
				.send(fallbackShell);
		if (renderFn === null) {
			// Module not yet resolved; fall back without logging to avoid startup
			// noise before the first render is even possible. A terminal load
			// failure (import reject or 30s timeout) process.exit(1)s from the
			// loader above, so this branch is only the brief warmup window.
			return sendFallback();
		}
		try {
			const result = await renderFn(
				req.url,
				`${req.protocol}://${req.hostname}`,
			);
			if (result.redirect) {
				// Redirect thrown from a loader/action surfaces as a Response.
				// Forward it so the browser actually navigates to the new URL
				// instead of seeing an empty shell with a stale status.
				res.redirect(result.status, result.redirect);
				return;
			}
			if (!result.html) {
				// A non-redirect Response was thrown from a loader (e.g.
				// `throw new Response(null, { status: 404 })`). renderToString
				// produced no markup, so we have a real status but no body.
				// Log so the case is observable in ops dashboards, and mark
				// no-store so CDNs don't cache an empty page as a valid hit.
				// User-visible 404 / error pages should come from a route
				// errorElement, not from this fallback path.
				console.error("ssr.render.error-response", {
					url: req.url,
					status: result.status,
				});
				res
					.status(result.status)
					.set("Content-Type", "text/html; charset=utf-8")
					.set("Cache-Control", "no-store")
					.send(fallbackShell);
				return;
			}
			// Per-host SEO injection. System URLs get a noindex meta so
			// crawlers drop them from the index over time; customer-attached
			// hosts get a self-canonical link so search engines treat them
			// as authoritative for the rendered content.
			const seoHead = isSystemHost(req)
				? `<meta name="robots" content="noindex,nofollow">`
				: `<link rel="canonical" href="${escapeXml(`${req.protocol}://${req.hostname}${req.path}`)}">`;
			// Function replacements disable String.replace's $-special sequences
			// ($&, $', $`, $$) so user-authored titles / JSON-LD like
			// "Save $& today" insert literally instead of being interpolated.
			const out = renderSsrDocument(
				template,
				{ ...result, head: seoHead + result.head },
				adSenseRuntimeConfig,
			);
			res
				.status(result.status)
				.set("Content-Type", "text/html; charset=utf-8")
				.set("Cache-Control", "no-cache")
				.send(out);
		} catch (err) {
			// 503 surfaces the failure in CDN/monitoring without caching a broken
			// page as success. console.error (not warn) puts it at the right log
			// level for the observability pipeline to alert on.
			console.error("ssr.render.failed", {
				url: req.url,
				// Log the full stack — React's renderToString annotates it with
				// the failing component's call tree, which the message alone
				// discards.
				error: err instanceof Error ? err.stack : String(err),
			});
			sendFallback();
		}
	});

	const shutdown = async (signal: string) => {
		console.log(`Got ${signal}, shutting down gracefully...`);
		// Scope the ERR_MODULE_NOT_FOUND suppression to the import() only.
		// A closeConnection() failure that happens to carry the same code
		// (unlikely but possible for wrapped errors) must not be silently
		// swallowed - it indicates a real db-close failure worth logging.
		let mod: { closeConnection?: () => Promise<void> | void } | null = null;
		try {
			const dbClient = "./db/client" + ".js";
			// Source-literal optional module path; no request, environment, or user input reaches import().
			// eslint-disable-next-line no-unsanitized/method
			mod = await import(/* @vite-ignore */ dbClient);
		} catch (error: unknown) {
			const code = (error as { code?: string } | null)?.code;
			if (code !== "ERR_MODULE_NOT_FOUND") {
				console.error("ssr.shutdown.db-import-failed", {
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
		if (mod && typeof mod.closeConnection === "function") {
			try {
				await mod.closeConnection();
				console.log("Database connections closed");
			} catch (error: unknown) {
				console.error("ssr.shutdown.db-close-failed", {
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
		process.exit(0);
	};

	(["SIGTERM", "SIGINT"] as const).forEach((signal) => {
		process.once(signal, () => {
			void shutdown(signal);
		});
	});

	const rawPort = process.env.PORT || "3000";
	const port = parseInt(rawPort, 10);
	if (!Number.isInteger(port) || port <= 0 || port > 65535) {
		// parseInt("abc") returns NaN; passing that to app.listen throws
		// synchronously before the server.on("error") handler below can catch
		// it. Fail fast with an actionable log rather than a cryptic crash.
		console.error("ssr.server.invalid-port", { rawPort });
		process.exit(1);
	}
	const host = process.env.HOST || "0.0.0.0";
	const server = app.listen(port, host, () => {
		console.log(`Server listening on http://${host}:${port}`);
	});
	server.on("error", (err: NodeJS.ErrnoException) => {
		console.error("ssr.server.listen-failed", {
			port,
			host,
			code: err.code,
			error: err.message,
		});
		process.exit(1);
	});
}

export default app;
