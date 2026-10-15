import { describe, it, expect } from "vitest";
import { isSystemHost } from "./seo-host";

describe("isSystemHost", () => {
	it("flags Railway temporary domains as system hosts", () => {
		expect(isSystemHost({ hostname: "connection-pilot-production.up.railway.app" })).toBe(true);
		expect(isSystemHost({ hostname: "something.railway.app" })).toBe(true);
	});

	it("flags the apex railway.app as a system host", () => {
		expect(isSystemHost({ hostname: "railway.app" })).toBe(true);
	});

	it("does NOT flag look-alike hosts that lack the dot separator", () => {
		// endsWith(".railway.app") guards against suffix-injection like
		// `evil-railway.app`, which would otherwise be treated as a system
		// host and silently noindexed.
		expect(isSystemHost({ hostname: "evil-railway.app" })).toBe(false);
		expect(isSystemHost({ hostname: "notrailway.app" })).toBe(false);
	});

	it("normalises case before matching", () => {
		expect(isSystemHost({ hostname: "XYZ.Up.Railway.APP" })).toBe(true);
		expect(isSystemHost({ hostname: "Acme.COM" })).toBe(false);
	});

	it("treats empty/local hostnames as system hosts (dev safety)", () => {
		expect(isSystemHost({ hostname: "" })).toBe(true);
		expect(isSystemHost({ hostname: undefined })).toBe(true);
		expect(isSystemHost({ hostname: null })).toBe(true);
		expect(isSystemHost({ hostname: "localhost" })).toBe(true);
		expect(isSystemHost({ hostname: "127.0.0.1" })).toBe(true);
	});

	it("does NOT flag the production domain as a system host", () => {
		expect(isSystemHost({ hostname: "connectionpilot.net" })).toBe(false);
		expect(isSystemHost({ hostname: "www.connectionpilot.net" })).toBe(false);
	});

	it("does NOT flag customer-attached domains as system hosts", () => {
		expect(isSystemHost({ hostname: "acme.com" })).toBe(false);
		expect(isSystemHost({ hostname: "shop.acme.co.uk" })).toBe(false);
		expect(isSystemHost({ hostname: "example.org" })).toBe(false);
	});
});
