// Hosts that must not be indexed: localhost and the temporary Railway domains
// (*.up.railway.app) used before/besides the real domain. Any other host
// (connectionpilot.net, www.connectionpilot.net, ...) gets Allow + self-canonical;
// system hosts get Disallow + noindex.
export const SYSTEM_HOST_SUFFIXES = [
	".up.railway.app",
	".railway.app",
];

export function isSystemHost(req: { hostname?: string | null }): boolean {
	const h = (req.hostname || "").toLowerCase();
	if (!h || h === "localhost" || h === "127.0.0.1") return true;
	return SYSTEM_HOST_SUFFIXES.some(
		(s) => h === s.replace(/^\./, "") || h.endsWith(s),
	);
}
