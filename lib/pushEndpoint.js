export function isPublicPushHostname(rawHostname) {
  const hostname = rawHostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    hostname === "::1"
  ) {
    return false;
  }

  const isIpv6Literal = hostname.includes(":");
  if (
    isIpv6Literal &&
    (/^(?:fc|fd)/.test(hostname) || /^fe[89ab]/.test(hostname))
  ) {
    return false;
  }

  if (/^127(?:\.\d{1,3}){3}$/.test(hostname)) return false;
  if (/^10(?:\.\d{1,3}){3}$/.test(hostname)) return false;
  if (/^192\.168(?:\.\d{1,3}){2}$/.test(hostname)) return false;
  const private172 = hostname.match(/^172\.(\d{1,3})(?:\.\d{1,3}){2}$/);
  if (private172) {
    const secondOctet = Number(private172[1]);
    if (secondOctet >= 16 && secondOctet <= 31) return false;
  }
  return true;
}
