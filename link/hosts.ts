/**
 * Which machines the link will talk to. The games are made for one network, so anything that decides where to connect
 * or who may connect is limited to this computer and private network addresses.
 */

/** the host part of "host:port" or "[v6]:port", lower case, without brackets */
export function hostnameOf(hostPort: string): string {
  const h = hostPort.trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(1, h.indexOf(']') < 0 ? undefined : h.indexOf(']'));
  const colons = h.split(':').length - 1;
  return colons === 1 ? h.slice(0, h.indexOf(':')) : h; // a bare IPv6 address has many colons and no port
}

/** this computer, a .local name, or an address from a private range (10.x, 172.16-31.x, 192.168.x, link-local, IPv6 local) */
export function isPrivateHost(hostPort: string): boolean {
  const h = hostnameOf(hostPort);
  if (!h) return false;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '::1') return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if ([a, b, Number(v4[3]), Number(v4[4])].some((n) => n > 255)) return false;
    return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
  }
  return /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h);
}

/**
 * A browser always says which page opened a WebSocket. Refuse the ones opened by a page from somewhere else on the
 * internet (so a website cannot talk to the relay running on this computer), and allow this computer, private
 * addresses (the other game on the LAN) and a page served from the same host. A client with no Origin is not a browser.
 */
export function originAllowed(origin: string | undefined, hostHeader: string | undefined): boolean {
  if (!origin) return true;
  let o: URL;
  try { o = new URL(origin); } catch { return false; }
  if (o.protocol !== 'http:' && o.protocol !== 'https:') return false;
  return isPrivateHost(o.host) || (!!hostHeader && hostnameOf(o.host) === hostnameOf(hostHeader));
}

/** the relay a page may use: the one named by ?relay= only if it is on this computer or a private network, else the page's own */
export function pickRelay(param: string | null, ownHost: string): string {
  if (param && /^[\w.-]+(:\d+)?$|^\[[0-9a-f:]+\](:\d+)?$/i.test(param) && isPrivateHost(param)) return param;
  return ownHost;
}
