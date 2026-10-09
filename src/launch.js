import { spawn } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import path from 'node:path';

export function resolveClaude({ platform = process.platform, env = process.env } = {}) {
  const dirs = (env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts = platform === 'win32'
    ? (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map((e) => e.toLowerCase())
    : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, `claude${ext}`);
      try {
        if (!statSync(candidate).isFile()) continue;
        if (platform !== 'win32') accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // not there or not executable: keep looking
      }
    }
  }
  return null;
}

export function quoteForCmd(arg) {
  if (/^[\w\-=.:\\/]+$/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

export function launchClaude({ claudePath, args, env, spawnImpl = spawn }) {
  const useShell = /\.(cmd|bat)$/i.test(claudePath);
  const command = useShell ? `"${claudePath}"` : claudePath;
  const childArgs = useShell ? args.map(quoteForCmd) : args;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnImpl(command, childArgs, { stdio: 'inherit', env, shell: useShell });
    } catch (error) {
      resolve({ code: 1, error });
      return;
    }
    const onSigint = () => {
      // no-op: let the child handle SIGINT
    };
    const onSigterm = () => {
      child.kill('SIGTERM');
    };
    // A closed terminal sends SIGHUP: pass it on so claude exits and the wrapper can finish
    // (record usage, end a temporary login) instead of dying first.
    const onSighup = () => {
      child.kill('SIGHUP');
    };
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);
    process.on('SIGHUP', onSighup);
    const cleanup = () => {
      process.removeListener('SIGINT', onSigint);
      process.removeListener('SIGTERM', onSigterm);
      process.removeListener('SIGHUP', onSighup);
    };
    child.on('error', (error) => {
      cleanup();
      resolve({ code: 1, error });
    });
    child.on('exit', (code, signal) => {
      cleanup();
      resolve({ code: code ?? 1, signal: signal ?? undefined });
    });
  });
}
