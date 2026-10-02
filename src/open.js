import { spawn } from 'node:child_process';

function launcher(platform, url) {
  if (platform === 'darwin') return ['open', [url]];
  if (platform === 'win32') return ['rundll32', ['url.dll,FileProtocolHandler', url]];
  return ['xdg-open', [url]];
}

export function openBrowser(url, { platform = process.platform, spawnImpl = spawn } = {}) {
  const [cmd, args] = launcher(platform, url);
  try {
    const child = spawnImpl(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
