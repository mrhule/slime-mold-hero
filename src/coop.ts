import { Link, WebSocketTransport } from '../link/client';
import { RELAY_PATH } from '../link/relay-path';

/** this game's side of the co-op link: it plays the hero */
export function makeLink(): Link {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${RELAY_PATH}`;
  return new Link(() => new WebSocketTransport(url), { role: 'hero', name: 'Hero' });
}
