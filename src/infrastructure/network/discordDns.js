import dns from 'node:dns';
import net from 'node:net';

let applied = false;

export function applyDiscordNetworkFix() {
  if (applied) return;
  applied = true;

  try {
    dns.setDefaultResultOrder('ipv4first');
  } catch {}

  try {
    if (typeof net.setDefaultAutoSelectFamily === 'function') {
      net.setDefaultAutoSelectFamily(false);
    }
  } catch {}
}
